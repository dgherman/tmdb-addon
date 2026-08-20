require('dotenv').config()
const { get } = require('../utils/httpClient')
const { redactUrl } = require('../utils/logError')

async function getRequestToken() {
  return get(`https://api.themoviedb.org/3/authentication/token/new?api_key=${process.env.TMDB_API}`)
    .then((res) => {
      return res.data
    })
    .catch(err => {
      return { success: false, status_message: redactUrl(err.message) }
    })
}

async function getSessionId(requestToken) {
  return get(`https://api.themoviedb.org/3/authentication/session/new?api_key=${process.env.TMDB_API}&request_token=${requestToken}`)
    .then((res) => {
      return res.data
    })
    .catch(err => {
      return { success: false, status_message: redactUrl(err.message) }
    })
}

module.exports = { getRequestToken, getSessionId };