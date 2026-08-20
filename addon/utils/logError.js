/**
 * Secret-safe error logging helpers.
 *
 * Axios attaches the full request config to every error it rejects with, and
 * moviedb-promise puts the TMDB API key in that config as `params.api_key`.
 * Passing such an error straight to `console.error` therefore prints the key in
 * cleartext to the process logs. These helpers log only a derived status and
 * the error message, never the error object, its config, or a request URL.
 */

/**
 * Derive a loggable status from an error without touching its config.
 * Covers HTTP responses, errors raised by the TMDB client, and transport level
 * failures (DNS, TLS, timeouts) that never produce a response at all.
 *
 * @param {any} error - The rejected value.
 * @returns {string|number} - An HTTP status, an error code, or "no-response".
 */
function getErrorStatus(error) {
  return error?.response?.status ?? error?.statusCode ?? error?.code ?? "no-response";
}

/**
 * Log a failed operation with context, without serializing the error object.
 *
 * @param {string} operation - What was being attempted.
 * @param {any} error - The rejected value.
 * @param {Object} [context] - Extra key/value pairs to include (ids, seasons...).
 */
function logError(operation, error, context = {}) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  console.error(
    `${operation}${details ? ` (${details})` : ""} [${getErrorStatus(error)}]: ${error?.message ?? "unknown error"}`
  );
}

module.exports = { getErrorStatus, logError };
