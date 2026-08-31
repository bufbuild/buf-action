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

import { exchangeIDTokenForBufToken } from "./federation.ts";
import type { ExchangeOptions } from "./federation.ts";

const idToken = "header.payload.signature";
const mintedToken = "buf_minted_token";

// harness records what the exchange did, so tests can assert on the request it
// sent and, critically, on the order in which secrets were masked.
interface Harness {
  options: ExchangeOptions;
  requests: { url: string; body: URLSearchParams }[];
  masked: string[];
  events: string[];
  sleeps: number[];
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
    // The registry rejects the RFC 8693 parameters it does not honor — scope,
    // resource, audience, actor_token, and a requested_token_type it cannot
    // issue — rather than ignoring them. Adding one here would turn every
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
});
