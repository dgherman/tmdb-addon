const test = require("node:test");
const assert = require("node:assert");
const { getErrorStatus, logError, redactUrl } = require("./logError");

const FAKE_TMDB_KEY = "SYNTHETIC_TMDB_KEY_0000";
const FAKE_BEARER = "SYNTHETIC_TRAKT_TOKEN_0000";

function captureConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

/**
 * A faithful stand-in for the error axios rejects with: the request config
 * (params AND headers), plus a request object, all hang off the error.
 */
function makeAxiosError(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: { status_message: "Invalid API key" } };
  error.config = {
    url: `https://api.themoviedb.org/3/tv/1396?api_key=${FAKE_TMDB_KEY}`,
    params: { api_key: FAKE_TMDB_KEY, language: "en-US" },
    headers: {
      Authorization: `Bearer ${FAKE_BEARER}`,
      "trakt-api-key": "SYNTHETIC_TRAKT_CLIENT_ID",
    },
    data: JSON.stringify({ client_secret: "SYNTHETIC_CLIENT_SECRET" }),
  };
  error.request = { path: `/3/tv/1396?api_key=${FAKE_TMDB_KEY}`, method: "GET" };
  return error;
}

test("getErrorStatus prefers the HTTP status", () => {
  assert.strictEqual(getErrorStatus(makeAxiosError(401)), 401);
});

test("getErrorStatus falls back to statusCode then code then no-response", () => {
  assert.strictEqual(getErrorStatus({ statusCode: 429 }), 429);
  assert.strictEqual(getErrorStatus({ code: "ENOTFOUND" }), "ENOTFOUND");
  assert.strictEqual(getErrorStatus(new Error("boom")), "no-response");
  assert.strictEqual(getErrorStatus(undefined), "no-response");
});

test("logError never serializes the request config, headers or the API key", () => {
  const output = captureConsoleError(() =>
    logError("getEpisodes: failed to fetch default season episodes", makeAxiosError(401), {
      tmdbId: 1396,
      seasons: "season/1",
    })
  );

  assert.ok(!output.includes("api_key"), "output must not contain api_key");
  assert.ok(!output.includes(FAKE_TMDB_KEY), "output must not contain the TMDB key");
  assert.ok(!output.includes(FAKE_BEARER), "output must not contain the bearer token");
  assert.ok(!output.includes("Authorization"), "output must not contain headers");
  assert.ok(!output.includes("client_secret"), "output must not contain the request body");
  assert.match(output, /tmdbId=1396/);
  assert.match(output, /seasons=season\/1/);
  assert.match(output, /\[401\]/);
  assert.match(output, /Request failed with status code 401/);
});

test("logError reports a usable status for transport failures", () => {
  const error = new Error("getaddrinfo ENOTFOUND api.themoviedb.org");
  error.code = "ENOTFOUND";
  error.config = { params: { api_key: FAKE_TMDB_KEY } };

  const output = captureConsoleError(() => logError("getTrending: failed", error, { type: "movie" }));

  assert.ok(!output.includes("api_key"));
  assert.match(output, /\[ENOTFOUND\]/);
  assert.ok(!output.includes("undefined"), "must not print 'HTTP undefined'");
});

test("logError redacts credentials echoed inside the error message", () => {
  const error = new Error(
    `connect ECONNREFUSED via https://proxyuser:SYNTHETIC_PROXY_PASSWORD@proxy.internal:8080 for https://api.mdblist.com/lists/1/items?apikey=SYNTHETIC_MDBLIST_KEY`
  );
  error.code = "ECONNREFUSED";

  const output = captureConsoleError(() => logError("fetchMDBListItems: failed", error, { listId: 1 }));

  assert.ok(!output.includes("SYNTHETIC_PROXY_PASSWORD"), "basic-auth password must be redacted");
  assert.ok(!output.includes("SYNTHETIC_MDBLIST_KEY"), "apikey value must be redacted");
  assert.match(output, /\[REDACTED\]/);
});

test("redactUrl redacts every credential-bearing query parameter", () => {
  const keys = [
    "api_key",
    "apikey",
    "api-key",
    "token",
    "access_token",
    "refresh_token",
    "client_secret",
    "password",
    "key",
  ];

  for (const name of keys) {
    const redacted = redactUrl(`https://example.test/path?${name}=SUPERSECRET&language=en-US`);
    assert.ok(!redacted.includes("SUPERSECRET"), `${name} value must be redacted`);
    assert.ok(redacted.includes(`${name}=[REDACTED]`), `${name} must be kept as a redacted param`);
    assert.ok(redacted.includes("language=en-US"), "harmless params must survive");
  }
});

test("redactUrl matches parameter names case-insensitively", () => {
  const redacted = redactUrl("https://example.test/p?API_KEY=SUPERSECRET&Access_Token=OTHERSECRET");
  assert.ok(!redacted.includes("SUPERSECRET"));
  assert.ok(!redacted.includes("OTHERSECRET"));
  assert.strictEqual(redacted, "https://example.test/p?API_KEY=[REDACTED]&Access_Token=[REDACTED]");
});

test("redactUrl redacts embedded basic-auth credentials", () => {
  assert.strictEqual(
    redactUrl("https://alice:hunter2@example.test/path"),
    "https://alice:[REDACTED]@example.test/path"
  );
  assert.strictEqual(
    redactUrl("mongodb://cacheuser:s3cr3t@mongo.internal:27017/cache"),
    "mongodb://cacheuser:[REDACTED]@mongo.internal:27017/cache"
  );
});

test("redactUrl leaves credential-free values untouched", () => {
  const clean = "https://api.themoviedb.org/3/tv/1396?language=en-US&page=2";
  assert.strictEqual(redactUrl(clean), clean);
  assert.strictEqual(redactUrl(undefined), undefined);
  assert.strictEqual(redactUrl(null), null);
  assert.strictEqual(redactUrl(42), 42);
});
