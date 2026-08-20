const { MovieDb } = require('moviedb-promise');
const { createAxiosInstance } = require('./httpClient');
const { logError, redactUrl } = require('./logError');

/**
 * Custom TMDB client with proxy support
 */
class TMDBClient extends MovieDb {
  constructor(apiKey) {
    super(apiKey);
    
    // Replace default request method
    this._request = async (url, options = {}) => {
      const instance = createAxiosInstance(url);
      
      try {
        const response = await instance.request({
          url,
          method: options.method || 'GET',
          data: options.data,
          params: options.params,
          headers: options.headers,
          ...options
        });
        
        return response.data;
      } catch (error) {
        // Trata erros 401 (API key inválida ou expirada)
        if (error.response && error.response.status === 401) {
          const errorMessage = error.response.data?.status_message || 'Invalid API key';
          const apiError = new Error('TMDB_API_KEY_INVALID');
          apiError.statusCode = 401;
          apiError.userMessage = `TMDB API Key is invalid or expired: ${errorMessage}`;
          apiError.originalError = error;
          logError('TMDBClient: TMDB rejected the API key', error, { url: redactUrl(url), detail: errorMessage });
          throw apiError;
        }
        
        // Trata outros erros HTTP
        if (error.response) {
          logError('TMDBClient: TMDB request failed', error, {
            url: redactUrl(url),
            detail: error.response.data?.status_message,
          });
        } else {
          logError('TMDBClient: TMDB request failed without a response', error, { url: redactUrl(url) });
        }
        throw error;
      }
    };
  }

  /**
   * Override request method to use our custom HTTP client
   */
  async request(url, options = {}) {
    return this._request(url, options);
  }
}

module.exports = { TMDBClient }; 