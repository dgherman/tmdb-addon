require('dotenv').config()
const { get } = require('../utils/httpClient')
const { getMeta } = require('./getMeta')
const { logError } = require('../utils/logError')

async function getTraktWatchlist(type, language, page, genre, accessToken) {
  if (!accessToken) {
    throw new Error('Trakt access token was not provided')
  }

  try {
    const typeParam = type === 'movie' ? 'movies' : 'shows'
    const limit = 20
    const offset = (page - 1) * limit

    const response = await get(`https://api.trakt.tv/sync/watchlist/${typeParam}?limit=${limit}&extended=full`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'trakt-api-version': '2',
        'trakt-api-key': process.env.TRAKT_CLIENT_ID
      }
    })

    const items = response.data || []
    const metas = []

    for (const item of items) {
      try {
        let tmdbId = null

        if (type === 'movie') {
          tmdbId = item.movie?.ids?.tmdb
        } else {
          tmdbId = item.show?.ids?.tmdb
        }

        if (tmdbId) {
          const meta = await getMeta(type, language, tmdbId)
          metas.push(meta.meta)
        }
      } catch (err) {
        logError('getTraktWatchlist: failed to process a watchlist item', err, {
          type,
          tmdbId: type === 'movie' ? item.movie?.ids?.tmdb : item.show?.ids?.tmdb,
        })
      }
    }

    return { metas }
  } catch (err) {
    logError('getTraktWatchlist: failed to fetch the Trakt watchlist', err, { type, language, page })
    throw err
  }
}

async function getTraktRecommendations(type, language, page, genre, accessToken) {
  if (!accessToken) {
    throw new Error('Trakt access token was not provided')
  }

  try {
    const typeParam = type === 'movie' ? 'movies' : 'shows'
    const limit = 20
    const offset = (page - 1) * limit

    const response = await get(`https://api.trakt.tv/recommendations/${typeParam}?limit=${limit}&extended=full`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'trakt-api-version': '2',
        'trakt-api-key': process.env.TRAKT_CLIENT_ID
      }
    })

    const items = response.data || []
    const metas = []

    for (const item of items) {
      try {
        const tmdbId = item.ids?.tmdb

        if (tmdbId) {
          const meta = await getMeta(type, language, tmdbId)
          metas.push(meta.meta)
        }
      } catch (err) {
        logError('getTraktRecommendations: failed to process a recommendation', err, {
          type,
          tmdbId: item.ids?.tmdb,
        })
      }
    }

    return { metas }
  } catch (err) {
    logError('getTraktRecommendations: failed to fetch Trakt recommendations', err, { type, language, page })
    throw err
  }
}

module.exports = { getTraktWatchlist, getTraktRecommendations }

