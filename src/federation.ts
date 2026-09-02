// Copyright 2024-2025 Buf Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as core from "@actions/core";

// RFC 8693 grant and token-type URNs for the workload identity exchange.
const grantTypeTokenExchange =
  "urn:ietf:params:oauth:grant-type:token-exchange";
const subjectTokenTypeIDToken = "urn:ietf:params:oauth:token-type:id_token";

// Timeout for a single exchange request. The registry verifies a JWT signature
// and may fetch the issuer's keys on a cold cache, so this is generous.
const requestTimeoutMs = 15_000;

// Retry only errors that a later attempt could plausibly resolve. Trust
// failures are never retried: the answer will not change, and hammering the
// endpoint on a misconfigured credential only slows the failure down.
const maxAttempts = 3;
const retryBaseDelayMs = 1_000;

// GitHub OIDC token claims that are safe to log at debug level. They are what
// a trust credential's conditions are matched against, and every value is
// already visible in the run's github context.
const loggedIDTokenClaims = [
  "iss",
  "sub",
  "aud",
  "jti",
  "iat",
  "exp",
  "repository",
  "repository_owner",
  "repository_id",
  "ref",
  "ref_type",
  "sha",
  "workflow",
  "workflow_ref",
  "job_workflow_ref",
  "event_name",
  "actor",
  "environment",
  "runner_environment",
];

// Response headers logged so a failed exchange can be correlated with the
// registry's own logs.
const loggedResponseHeaders = ["x-request-id", "traceparent"];

// Fields of a successful token response that are safe to log.
const loggedTokenResponseFields = [
  "token_type",
  "issued_token_type",
  "expires_in",
];

// TokenExchangeError carries the OAuth error code so callers can map a failure
// to advice without re-parsing the response body.
export class TokenExchangeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "TokenExchangeError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ExchangeOptions {
  // Registry hostname, such as "buf.build".
  domain: string;
  // Username of the bot user the workload authenticates as.
  username: string;
  // Injected by tests; defaults to the ambient fetch and @actions/core.
  fetchFn?: typeof fetch;
  getIDToken?: (audience: string) => Promise<string>;
  setSecret?: (secret: string) => void;
  sleep?: (ms: number) => Promise<void>;
  debug?: (message: string) => void;
  isDebug?: () => boolean;
}

// normalizeDomain strips anything a workflow may have pasted around the bare
// hostname. A scheme left in place would otherwise build the audience
// "https://https://host", which the registry rejects for reasons the message
// does not make obvious.
function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

// exchangeIDTokenForBufToken mints a short-lived registry token from the
// workload's own GitHub identity, so no long-lived API token has to be stored
// as a repository secret.
//
// The GitHub OIDC token and the minted registry token are both registered as
// secrets before either is returned, so neither can reach the log even if a
// later step or a thrown error would otherwise print it.
export async function exchangeIDTokenForBufToken(
  options: ExchangeOptions,
): Promise<string> {
  const {
    domain,
    username,
    fetchFn = fetch,
    getIDToken = core.getIDToken,
    setSecret = core.setSecret,
    sleep = defaultSleep,
    debug = core.debug,
    isDebug = core.isDebug,
  } = options;

  // The registry expects its own hostname, the same value its OAuth redirect
  // URLs are built from, so there is nothing to configure here.
  const host = normalizeDomain(domain);
  const audience = `https://${host}`;
  const endpoint = `https://${host}/oauth2/token`;
  if (host != domain) {
    debug(`Normalized domain "${domain}" to "${host}"`);
  }
  // The request URL is set only when the job has id-token: write, which
  // separates a missing permission from a GitHub outage.
  debug(
    `Requesting GitHub OIDC token for audience ${audience} ` +
      `(ACTIONS_ID_TOKEN_REQUEST_URL is ${
        process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? "set" : "not set"
      })`,
  );
  let idToken: string;
  try {
    idToken = await getIDToken(audience);
  } catch (error) {
    throw new Error(
      `Failed to request a GitHub OIDC token for audience ${audience}. ` +
        `The job must grant "permissions: id-token: write". ` +
        `Underlying error: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (idToken == "") {
    throw new Error(
      `GitHub returned an empty OIDC token for audience ${audience}. ` +
        `The job must grant "permissions: id-token: write".`,
    );
  }
  setSecret(idToken);
  if (isDebug()) {
    debug(
      `GitHub OIDC token claims: ${JSON.stringify(describeIDToken(idToken))}`,
    );
  }

  const body = new URLSearchParams({
    grant_type: grantTypeTokenExchange,
    subject_token: idToken,
    subject_token_type: subjectTokenTypeIDToken,
    account: username,
  });

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    try {
      const token = await postTokenExchange(fetchFn, endpoint, body, debug);
      // Mask before returning: every caller path that could log the token
      // runs after this point.
      setSecret(token);
      debug(`Token exchange succeeded in ${Date.now() - startedAt} ms`);
      return token;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryable =
        !(lastError instanceof TokenExchangeError) || lastError.retryable;
      debug(
        `Token exchange attempt ${attempt} of ${maxAttempts} failed after ` +
          `${Date.now() - startedAt} ms: ${lastError.message}`,
      );
      if (!retryable || attempt === maxAttempts) {
        break;
      }
      await sleep(retryBaseDelayMs * attempt);
    }
  }
  throw describeFailure(lastError, host, username);
}

// postTokenExchange performs one exchange request and returns the access token.
async function postTokenExchange(
  fetchFn: typeof fetch,
  endpoint: string,
  body: URLSearchParams,
  debug: (message: string) => void,
): Promise<string> {
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await response.text();
  debug(
    `Token exchange response from ${endpoint}: HTTP ${response.status}` +
      describeHeaders(response.headers),
  );
  if (!response.ok) {
    const { error, description } = parseOAuthError(text);
    throw new TokenExchangeError(
      description == "" ? error : `${error}: ${description}`,
      error,
      // 5xx is the registry failing, not the credential being wrong. So is
      // slow_down, which asks for exactly one thing: come back later.
      response.status >= 500 || error == "slow_down",
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new TokenExchangeError(
      "the registry returned a non-JSON response",
      "invalid_response",
      true,
    );
  }
  debug(
    `Token exchange response fields: ${JSON.stringify(
      pickFields(payload, loggedTokenResponseFields),
    )}`,
  );
  const accessToken = (payload as { access_token?: unknown }).access_token;
  if (typeof accessToken !== "string" || accessToken == "") {
    throw new TokenExchangeError(
      "the registry returned no access_token",
      "invalid_response",
      false,
    );
  }
  return accessToken;
}

// describeIDToken returns the loggable claims of the token, never the token
// or any of its segments: the runner masks the whole string, not substrings.
function describeIDToken(idToken: string): Record<string, unknown> {
  const segments = idToken.split(".");
  if (segments.length != 3) {
    return { error: "not a JWT" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString());
  } catch {
    return { error: "payload is not JSON" };
  }
  const claims = pickFields(payload, loggedIDTokenClaims);
  if (typeof claims.exp == "number") {
    claims.expires_in_seconds = claims.exp - Math.floor(Date.now() / 1000);
  }
  return claims;
}

// pickFields copies the named fields out of a decoded JSON object.
function pickFields(
  payload: unknown,
  names: string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  if (typeof payload != "object" || payload == null) {
    return picked;
  }
  for (const name of names) {
    if (name in payload) {
      picked[name] = (payload as Record<string, unknown>)[name];
    }
  }
  return picked;
}

// describeHeaders formats the correlation headers present on a response.
function describeHeaders(headers: Headers): string {
  const parts: string[] = [];
  for (const name of loggedResponseHeaders) {
    const value = headers.get(name);
    if (value != null) {
      parts.push(`${name}=${value}`);
    }
  }
  return parts.length == 0 ? "" : ` (${parts.join(", ")})`;
}

// parseOAuthError pulls the RFC 6749 error envelope out of a response body,
// falling back to a generic code when the body is not the expected shape.
function parseOAuthError(text: string): {
  error: string;
  description: string;
} {
  try {
    const payload = JSON.parse(text) as {
      error?: unknown;
      error_description?: unknown;
    };
    return {
      error: typeof payload.error === "string" ? payload.error : "unknown",
      description:
        typeof payload.error_description === "string"
          ? payload.error_description
          : "",
    };
  } catch {
    return { error: "unknown", description: text.slice(0, 200) };
  }
}

// describeFailure turns an exchange failure into advice.
//
// The registry answers every trust failure with the same opaque invalid_grant,
// deliberately, so that a caller cannot probe which accounts or conditions
// exist. That means this cannot say which check failed, only what to go and
// look at.
export function describeFailure(
  error: Error | undefined,
  domain: string,
  username: string,
): Error {
  if (!(error instanceof TokenExchangeError)) {
    return new Error(
      `Failed to exchange the GitHub OIDC token with ${domain}: ${errorMessage(error)}`,
    );
  }
  switch (error.code) {
    case "unsupported_grant_type":
      return new Error(
        `${domain} does not accept workload identity federation. ` +
          `Either the registry does not have it enabled, or it is an older version. ` +
          `Use the "token" input instead.`,
      );
    case "invalid_grant":
      return new Error(
        `${domain} refused to authenticate this workflow as bot user ${username}. ` +
          `The registry does not report which check failed, by design. Verify that ` +
          `the username is right and names an active bot user, that it has a trust ` +
          `credential for GitHub Actions, and that the credential's claim ` +
          `conditions match this repository, ref, and workflow exactly. ` +
          `Enable step debug logging to see the claims GitHub put in the token.`,
      );
    case "invalid_request":
      return new Error(
        `${domain} rejected the token exchange request as malformed: ${error.message}`,
      );
    default:
      return new Error(
        `Failed to exchange the GitHub OIDC token with ${domain}: ${error.message}`,
      );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
