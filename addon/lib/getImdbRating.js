const axios = require('axios');
const { logError } = require('../utils/logError');

async function getImdbRating(imdbId, type) {
  try {
    const response = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, {
      timeout: 10000
    });
    const data = response.data.meta;
    return data?.imdbRating || undefined
  } catch (error) {
    logError('getImdbRating: failed to fetch data from Cinemeta', error, { imdbId, type });
    return null;
  }
}

module.exports = { getImdbRating }