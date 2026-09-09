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

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { exchangeIDTokenForBufToken, revokeBufToken } from "./federation.ts";
import type { ExchangeOptions } from "./federation.ts";

// A GitHub OIDC token with a decodable payload, so tests can check that debug
// output reports claims without ever reproducing the token or its segments.
const idTokenClaims = {
  iss: "https://token.actions.githubusercontent.com",
  sub: "repo:acme/protos:ref:refs/heads/main",
  aud: "https://buf.build",
  jti: "f3a1c1a2-7d0b-4a6b-9a0c-1f5e2b3c4d5e",
  exp: Math.floor(Date.now() / 1000) + 300,
  repository: "acme/protos",
  ref: "refs/heads/main",
  workflow_ref: "acme/protos/.github/workflows/buf-ci.yaml@refs/heads/main",
};
const idTokenPayload = Buffer.from(JSON.stringify(idTokenClaims)).toString(
  "base64url",
);
const idToken = `eyJhbGciOiJSUzI1NiJ9.${idTokenPayload}.c2lnbmF0dXJl`;
const mintedToken = "buf_minted_token";

// harness records what the exchange did, so tests can assert on the request it
// sent and, critically, on the order in which secrets were masked.
interface Harness {
  options: ExchangeOptions;
  requests: { url: string; body: URLSearchParams }[];
  masked: string[];
  events: string[];
  sleeps: number[];
  debugLines: string[];
}

function newHarness(
  responses: (() => Response)[],
  overrides: Partial<ExchangeOptions> = {},
): Harness {
  const harness: Harness = {
    requests: [],
    masked: [],
    events: [],
    sleeps: [],
    debugLines: [],
    options: {} as ExchangeOptions,
  };
  let attempt = 0;
  harness.options = {
    domain: "buf.build",
    username: "my-bot-user",
    getIDToken: async (audience: string) => {
      harness.events.push(`getIDToken:${audience}`);
      return idToken;
    },
    setSecret: (secret: string) => {
      harness.masked.push(secret);
      harness.events.push(`setSecret:${secret}`);
    },
    sleep: async (ms: number) => {
      harness.sleeps.push(ms);
    },
    debug: (message: string) => {
      harness.debugLines.push(message);
    },
    isDebug: () => true,
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      harness.requests.push({
        url: String(url),
        body: new URLSearchParams(String(init?.body ?? "")),
      });
      harness.events.push("fetch");
      const response = responses[Math.min(attempt, responses.length - 1)];
      attempt++;
      return response();
    }) as unknown as typeof fetch,
    ...overrides,
  };
  return harness;
}

function okResponse(token = mintedToken): Response {
  return new Response(
    JSON.stringify({
      access_token: token,
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      token_type: "bearer",
      expires_in: 3600,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function oauthErrorResponse(
  status: number,
  error: string,
  description = "",
): Response {
  return new Response(
    JSON.stringify({ error, error_description: description }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("exchangeIDTokenForBufToken", () => {
  test("exchanges the OIDC token for a registry token", async () => {
    const harness = newHarness([() => okResponse()]);
    const token = await exchangeIDTokenForBufToken(harness.options);

    assert.equal(token, mintedToken);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, "https://buf.build/oauth2/token");
    const body = harness.requests[0].body;
    assert.equal(
      body.get("grant_type"),
      "urn:ietf:params:oauth:grant-type:token-exchange",
    );
    assert.equal(body.get("subject_token"), idToken);
    assert.equal(
      body.get("subject_token_type"),
      "urn:ietf:params:oauth:token-type:id_token",
    );
    assert.equal(body.get("account"), "my-bot-user");
  });

  test("normalizes a domain that carries a scheme or trailing slash", async () => {
    // A workflow that pastes the full URL would otherwise ask GitHub for the
    // audience "https://https://buf.build" and get a token the registry refuses.
    const harness = newHarness([() => okResponse()], {
      domain: "https://buf.build/",
    });
    const token = await exchangeIDTokenForBufToken(harness.options);

    assert.equal(token, mintedToken);
    assert.equal(harness.requests[0].url, "https://buf.build/oauth2/token");
    assert.ok(harness.events.includes("getIDToken:https://buf.build"));
  });

  test("sends exactly the parameters the registry accepts", async () => {
    // The registry rejects, rather than ignores, the RFC 8693 parameters it
    // does not honor (scope, resource, audience, actor_token, and a
    // requested_token_type it cannot issue). Adding one here would turn every
    // exchange into an invalid_request, so the key set is pinned.
    const harness = newHarness([() => okResponse()]);
    await exchangeIDTokenForBufToken(harness.options);
    assert.deepEqual([...harness.requests[0].body.keys()].sort(), [
      "account",
      "grant_type",
      "subject_token",
      "subject_token_type",
    ]);
  });

  test("requests the OIDC token for the registry's audience", async () => {
    const harness = newHarness([() => okResponse()]);
    await exchangeIDTokenForBufToken(harness.options);
    assert.deepEqual(harness.events[0], "getIDToken:https://buf.build");
  });

  test("masks the OIDC token before it is ever sent", async () => {
    // Order is the whole point: a request that fails and gets logged must not
    // be the first place the JWT appears unmasked.
    const harness = newHarness([() => okResponse()]);
    await exchangeIDTokenForBufToken(harness.options);
    assert.deepEqual(harness.events, [
      "getIDToken:https://buf.build",
      `setSecret:${idToken}`,
      "fetch",
      `setSecret:${mintedToken}`,
    ]);
  });

  test("masks the minted token before returning it", async () => {
    const harness = newHarness([() => okResponse()]);
    const token = await exchangeIDTokenForBufToken(harness.options);
    const maskIndex = harness.events.indexOf(`setSecret:${token}`);
    assert.notEqual(maskIndex, -1, "the minted token must be masked");
    assert.equal(
      maskIndex,
      harness.events.length - 1,
      "masking must be the last thing before the token is handed back",
    );
  });

  test("does not retry a trust failure", async () => {
    // invalid_grant means the credential does not authorize this workflow.
    // Retrying cannot change that, and only delays a clear failure.
    const harness = newHarness([
      () => oauthErrorResponse(400, "invalid_grant", "not authorized"),
    ]);
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /refused to authenticate this workflow as bot user my-bot-user/,
    );
    assert.equal(harness.requests.length, 1);
    assert.deepEqual(harness.sleeps, []);
  });

  test("does not retry a malformed request", async () => {
    const harness = newHarness([
      () => oauthErrorResponse(400, "invalid_request", "missing account"),
    ]);
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /rejected the token exchange request as malformed/,
    );
    assert.equal(harness.requests.length, 1);
  });

  test("explains that the registry does not support federation", async () => {
    const harness = newHarness([
      () => oauthErrorResponse(400, "unsupported_grant_type"),
    ]);
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /does not accept workload identity federation/,
    );
    assert.equal(harness.requests.length, 1);
  });

  test("retries a server error and succeeds", async () => {
    let call = 0;
    const harness = newHarness([
      () => {
        call++;
        return call === 1
          ? oauthErrorResponse(503, "server_error", "try again")
          : okResponse();
      },
    ]);
    const token = await exchangeIDTokenForBufToken(harness.options);
    assert.equal(token, mintedToken);
    assert.equal(harness.requests.length, 2);
    assert.deepEqual(harness.sleeps, [1000]);
  });

  test("retries slow_down", async () => {
    let call = 0;
    const harness = newHarness([
      () => {
        call++;
        return call === 1
          ? oauthErrorResponse(400, "slow_down", "rate limit exceeded")
          : okResponse();
      },
    ]);
    assert.equal(
      await exchangeIDTokenForBufToken(harness.options),
      mintedToken,
    );
    assert.equal(harness.requests.length, 2);
  });

  test("gives up after the retry budget is exhausted", async () => {
    const harness = newHarness([() => oauthErrorResponse(500, "server_error")]);
    await assert.rejects(() => exchangeIDTokenForBufToken(harness.options));
    assert.equal(harness.requests.length, 3);
    assert.deepEqual(harness.sleeps, [1000, 2000]);
  });

  test("retries a network failure", async () => {
    let call = 0;
    const harness = newHarness([], {
      fetchFn: (async () => {
        call++;
        if (call === 1) {
          throw new Error("ECONNRESET");
        }
        return okResponse();
      }) as unknown as typeof fetch,
    });
    assert.equal(
      await exchangeIDTokenForBufToken(harness.options),
      mintedToken,
    );
    assert.equal(call, 2);
  });

  test("points at the missing id-token permission", async () => {
    const harness = newHarness([() => okResponse()], {
      getIDToken: async () => {
        throw new Error("Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env");
      },
    });
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /permissions: id-token: write/,
    );
    assert.equal(harness.requests.length, 0);
  });

  test("rejects an empty OIDC token without calling the registry", async () => {
    const harness = newHarness([() => okResponse()], {
      getIDToken: async () => "",
    });
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /permissions: id-token: write/,
    );
    assert.equal(harness.requests.length, 0);
  });

  test("rejects a success response carrying no token", async () => {
    // A 200 with no access_token would otherwise become an empty BUF_TOKEN and
    // fail much later, somewhere unrelated.
    const harness = newHarness([
      () =>
        new Response(JSON.stringify({ token_type: "bearer" }), {
          status: 200,
        }),
    ]);
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /no access_token/,
    );
    assert.equal(harness.requests.length, 1);
  });

  test("handles an error body that is not JSON", async () => {
    const harness = newHarness([
      () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    ]);
    await assert.rejects(
      () => exchangeIDTokenForBufToken(harness.options),
      /502 Bad Gateway/,
    );
  });
  test("debug output reports the claims a trust credential matches on", async () => {
    const harness = newHarness([() => okResponse()]);
    await exchangeIDTokenForBufToken(harness.options);
    const claimsLine = harness.debugLines.find((line) =>
      line.startsWith("GitHub OIDC token claims: "),
    );
    assert.ok(claimsLine, "claims must be logged at debug level");
    const claims = JSON.parse(
      claimsLine.slice("GitHub OIDC token claims: ".length),
    );
    assert.equal(claims.repository, "acme/protos");
    assert.equal(claims.ref, "refs/heads/main");
    assert.equal(claims.jti, idTokenClaims.jti);
    assert.equal(typeof claims.expires_in_seconds, "number");
  });

  test("debug output never contains a token or a token segment", async () => {
    // The runner masks a registered secret only as a whole string, so even a
    // lone base64 segment of the JWT would land in the log unmasked.
    let call = 0;
    const harness = newHarness([
      () => {
        call++;
        return call === 1
          ? new Response(JSON.stringify({ error: "server_error" }), {
              status: 503,
              headers: { "x-request-id": "req-123" },
            })
          : okResponse();
      },
    ]);
    await exchangeIDTokenForBufToken(harness.options);
    assert.ok(harness.debugLines.length > 0);
    for (const line of harness.debugLines) {
      for (const segment of idToken.split(".")) {
        assert.ok(
          !line.includes(segment),
          `debug output leaks the OIDC token: ${line}`,
        );
      }
      assert.ok(
        !line.includes(mintedToken),
        `debug output leaks the minted token: ${line}`,
      );
    }
    assert.ok(
      harness.debugLines.some((line) => line.includes("x-request-id=req-123")),
      "correlation headers must be logged",
    );
  });

  test("debug output includes the HTTP status of a failed attempt", async () => {
    const harness = newHarness([
      () => oauthErrorResponse(400, "invalid_grant", "not authorized"),
    ]);
    await assert.rejects(() => exchangeIDTokenForBufToken(harness.options));
    assert.ok(
      harness.debugLines.some((line) => line.includes("HTTP 400")),
      harness.debugLines.join("\n"),
    );
    assert.ok(
      harness.debugLines.some((line) => line.includes("attempt 1 of 3 failed")),
    );
  });
});

describe("revokeBufToken", () => {
  interface RevokeHarness {
    requests: { url: string; body: URLSearchParams }[];
    debugLines: string[];
    fetchFn: typeof fetch;
  }

  function newRevokeHarness(response: () => Response): RevokeHarness {
    const harness: RevokeHarness = {
      requests: [],
      debugLines: [],
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        harness.requests.push({
          url: String(url),
          body: new URLSearchParams(String(init?.body ?? "")),
        });
        return response();
      }) as unknown as typeof fetch,
    };
    return harness;
  }

  test("posts the token to the revocation endpoint", async () => {
    const harness = newRevokeHarness(() => new Response("", { status: 200 }));

    await revokeBufToken({
      domain: "https://bsr.acme.com/",
      token: mintedToken,
      fetchFn: harness.fetchFn,
      debug: (line) => harness.debugLines.push(line),
    });

    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, "https://bsr.acme.com/oauth2/revoke");
    assert.equal(harness.requests[0].body.get("token"), mintedToken);
    assert.equal(
      harness.requests[0].body.get("token_type_hint"),
      "access_token",
    );
    assert.ok(harness.debugLines.some((line) => line.includes("HTTP 200")));
  });

  test("names a registry without the endpoint", async () => {
    const harness = newRevokeHarness(
      () => new Response("<html>not found</html>", { status: 404 }),
    );

    await assert.rejects(
      revokeBufToken({
        domain: "buf.build",
        token: mintedToken,
        fetchFn: harness.fetchFn,
        debug: () => {},
      }),
      /buf.build does not support token revocation/,
    );
  });

  test("surfaces the OAuth error for a refused token", async () => {
    const harness = newRevokeHarness(() =>
      oauthErrorResponse(
        400,
        "unsupported_token_type",
        "only tokens minted by workload identity federation can be revoked",
      ),
    );

    await assert.rejects(
      revokeBufToken({
        domain: "buf.build",
        token: mintedToken,
        fetchFn: harness.fetchFn,
        debug: () => {},
      }),
      /unsupported_token_type: only tokens minted by workload identity federation can be revoked/,
    );
  });
});
