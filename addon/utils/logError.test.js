const test = require("node:test");
const assert = require("node:assert");
const { getErrorStatus, logError } = require("./logError");

function captureConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

// A stand-in for the error axios rejects with: the full request config, which
// moviedb-promise populates with the TMDB API key, hangs off the error.
function makeAxiosError(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: { status_message: "Invalid API key" } };
  error.config = {
    url: "https://api.themoviedb.org/3/tv/1396",
    params: { api_key: "SECRET_TMDB_KEY", language: "en-US" },
  };
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

test("logError never serializes the request config or the API key", () => {
  const output = captureConsoleError(() =>
    logError("getEpisodes: failed to fetch default season episodes", makeAxiosError(401), {
      tmdbId: 1396,
      seasons: "season/1",
    })
  );

  assert.ok(!output.includes("api_key"), "output must not contain api_key");
  assert.ok(!output.includes("SECRET_TMDB_KEY"), "output must not contain the key value");
  assert.match(output, /tmdbId=1396/);
  assert.match(output, /seasons=season\/1/);
  assert.match(output, /\[401\]/);
  assert.match(output, /Request failed with status code 401/);
});

test("logError reports a usable status for transport failures", () => {
  const error = new Error("getaddrinfo ENOTFOUND api.themoviedb.org");
  error.code = "ENOTFOUND";
  error.config = { params: { api_key: "SECRET_TMDB_KEY" } };

  const output = captureConsoleError(() => logError("getTrending: failed", error, { type: "movie" }));

  assert.ok(!output.includes("api_key"));
  assert.match(output, /\[ENOTFOUND\]/);
  assert.ok(!output.includes("undefined"), "must not print 'HTTP undefined'");
});
