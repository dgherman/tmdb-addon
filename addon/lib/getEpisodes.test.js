/**
 * Integration test for the default season path in getEpisodes().
 *
 * This is the path that used to end in a bare `.catch(console.error)`, so the
 * test drives the real function with a TMDB client that rejects with an
 * Axios shaped error and asserts that nothing credential bearing reaches the
 * logs. It also confirms the happy path still returns a complete listing.
 */
const test = require("node:test");
const assert = require("node:assert");

const FAKE_TMDB_KEY = "SYNTHETIC_TMDB_KEY_0000";

const clientModule = require("../utils/getTmdbClient");
const originalGetTmdbClient = clientModule.getTmdbClient;

// getEpisodes destructures getTmdbClient at require time, so the module object
// has to be patched before it is required.
let nextClient = null;
clientModule.getTmdbClient = () => nextClient;
const { getEpisodes } = require("./getEpisodes");
test.after(() => {
  clientModule.getTmdbClient = originalGetTmdbClient;
});

function axiosRejection() {
  const error = new Error("Request failed with status code 401");
  error.response = { status: 401, data: { status_message: "Invalid API key: You must be granted a valid key." } };
  error.config = {
    url: `https://api.themoviedb.org/3/tv/1396?api_key=${FAKE_TMDB_KEY}`,
    params: { api_key: FAKE_TMDB_KEY, language: "en-US", append_to_response: "season/1" },
    headers: { Authorization: `Bearer SYNTHETIC_BEARER_0000` },
  };
  error.request = { path: `/3/tv/1396?api_key=${FAKE_TMDB_KEY}`, method: "GET" };
  return error;
}

function captureConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  return Promise.resolve()
    .then(fn)
    .then(
      (value) => {
        console.error = original;
        return { value, output: lines.join("\n") };
      },
      (error) => {
        console.error = original;
        throw error;
      }
    );
}

const SEASONS = [{ season_number: 1 }, { season_number: 2 }];

test("a failing default season request never logs the API key", async () => {
  nextClient = {
    tvInfo: async () => {
      throw axiosRejection();
    },
  };

  const { value, output } = await captureConsoleError(() =>
    getEpisodes("en-US", 1396, "tt0903747", SEASONS, {})
  );

  assert.deepStrictEqual(value, [], "a failed fetch yields no episodes");
  assert.ok(output.length > 0, "the failure must still be logged");
  assert.ok(!output.includes("api_key"), `output must not contain api_key, got: ${output}`);
  assert.ok(!output.includes(FAKE_TMDB_KEY), "output must not contain the key value");
  assert.ok(!output.includes("SYNTHETIC_BEARER_0000"), "output must not contain header credentials");
  assert.match(output, /tmdbId=1396/);
  assert.match(output, /\[401\]/);
});

test("the default season path still returns a complete listing", async () => {
  nextClient = {
    tvInfo: async ({ append_to_response }) => {
      const res = {};
      append_to_response.split(",").forEach((key) => {
        const season = Number(key.split("/")[1]);
        res[key] = {
          episodes: Array.from({ length: 3 }, (_, i) => ({
            season_number: season,
            episode_number: i + 1,
            name: `S${season}E${i + 1}`,
            still_path: `/s${season}e${i + 1}.jpg`,
            overview: "overview",
            vote_average: 8,
            runtime: 45,
            air_date: "2008-01-20",
          })),
        };
      });
      return res;
    },
  };

  const videos = await getEpisodes("en-US", 1396, "tt0903747", SEASONS, {});

  assert.strictEqual(videos.length, 6);
  assert.deepStrictEqual(
    videos.map((v) => v.id).sort(),
    ["tt0903747:1:1", "tt0903747:1:2", "tt0903747:1:3", "tt0903747:2:1", "tt0903747:2:2", "tt0903747:2:3"]
  );
});
