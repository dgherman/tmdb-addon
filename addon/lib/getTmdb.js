require('dotenv').config()
const { getTmdbClient } = require('../utils/getTmdbClient')
const { logError } = require("../utils/logError");

async function getTmdb(type, imdbId, config = {}) {
  try {
    const moviedb = getTmdbClient(config);
    if (type === "movie") {
      const tmdbId = await moviedb
        .find({ id: imdbId, external_source: 'imdb_id' })
        .then((res) => {
          return res.movie_results[0] ? res.movie_results[0].id : null;
        });
      return tmdbId;
    } else {
      const tmdbId = await moviedb
        .find({ id: imdbId, external_source: 'imdb_id' })
        .then((res) => {
          return res.tv_results[0] ? res.tv_results[0].id : null;
        });
      return tmdbId;
    }
  } catch (err) {
    if (err.message !== "TMDB_API_KEY_MISSING" && err.message !== "TMDB_API_KEY_INVALID") {
      logError("getTmdb: failed to convert the IMDb id", err, { imdbId, type });
    }
    return null;
  }
}

module.exports = { getTmdb };
