/**
 * Drives a real Axios rejection through the client layer.
 *
 * The getEpisodes integration test stubs getTmdbClient, so it never exercises
 * Axios itself. This one does: it points a real TMDBClient at a local server
 * that answers 401, so the error it handles is a genuine Axios error carrying
 * `config.params.api_key`, `config.headers` and a `request` object.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { TMDBClient } = require("./tmdbClient");

const FAKE_KEY = "SYNTHETIC_TMDB_KEY_0000";

function captureConsole(fn) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const lines = [];
  const collect = (...args) => lines.push(args.map(String).join(" "));
  console.error = collect;
  console.warn = collect;
  return Promise.resolve()
    .then(fn)
    .catch(() => {})
    .finally(() => {
      console.error = originalError;
      console.warn = originalWarn;
    })
    .then(() => lines.join("\n"));
}

test("a real Axios rejection through TMDBClient never logs the key", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status_message: "Invalid API key: You must be granted a valid key." }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const client = new TMDBClient(FAKE_KEY);
    let caught;

    const output = await captureConsole(async () => {
      // Exercise the overridden _request path with a real Axios round trip.
      await client
        .request(`http://127.0.0.1:${port}/3/tv/1396`, {
          params: { api_key: FAKE_KEY, language: "en-US" },
          headers: { Authorization: `Bearer SYNTHETIC_BEARER_0000` },
        })
        .catch((error) => {
          caught = error;
          throw error;
        });
    });

    assert.ok(caught, "the request must reject");
    assert.ok(caught.config || caught.originalError, "a genuine Axios error must reach the caller");
    assert.ok(output.length > 0, "the failure must be logged");
    assert.ok(!output.includes("api_key"), `log must not contain api_key, got: ${output}`);
    assert.ok(!output.includes(FAKE_KEY), "log must not contain the key value");
    assert.ok(!output.includes("SYNTHETIC_BEARER_0000"), "log must not contain header credentials");
    assert.match(output, /\[401\]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
