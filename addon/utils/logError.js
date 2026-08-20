/**
 * Secret-safe error logging helpers.
 *
 * Axios attaches the full request config to every error it rejects with, and
 * that config carries credentials: moviedb-promise puts the TMDB API key in
 * `params.api_key`, the Trakt calls put `client_secret` and refresh tokens in
 * the request body and `Authorization: Bearer` in the headers, and MDBList puts
 * its key straight into the request URL. Passing such an error to
 * `console.error` therefore prints those credentials in cleartext to the
 * process logs.
 *
 * These helpers log only a derived status and a redacted message, never the
 * error object, its config, its headers, its request, or a raw URL.
 */

// Query parameter names whose values must never reach the logs.
const SECRET_QUERY_KEYS = [
  "client_secret",
  "refresh_token",
  "access_token",
  "api_key",
  "apikey",
  "api-key",
  "password",
  "token",
  "key",
];

// Matches `?secret=value`, `&secret=value` and `#secret=value` (OAuth implicit
// flows put credentials in the fragment), longest key names first so that
// `api_key` is never partially matched as `key`. A parameter with no value at
// all is normalized to a redacted one, so `?token` cannot slip through as a
// hint that a value was stripped elsewhere.
const SECRET_QUERY_PATTERN = new RegExp(
  `([?&#](?:${SECRET_QUERY_KEYS.join("|")}))(=[^&#\\s"'\`<>]*)?`,
  "gi"
);

// Matches embedded basic-auth credentials, e.g. `https://user:pass@host/path`,
// `mongodb+srv://user:pass@host` or `redis://:pass@host`, where the username is
// empty. Both halves are redacted: the username is a credential in its own
// right and identifies the account being used.
const BASIC_AUTH_PATTERN = /(:\/\/)([^/\s:@]*):([^/\s@]*)(@)/g;

// `Authorization: Bearer x`, `Authorization: Basic x`, or a bare
// `Bearer x` / `Basic x` anywhere in a string - error messages and stacks can
// echo a header without the header name.
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{4,})/gi;

// JSON-ish body secrets: `"client_secret":"value"` or `client_secret: 'value'`.
const JSON_SECRET_PATTERN = new RegExp(
  `(["']?(?:${SECRET_QUERY_KEYS.join("|")})["']?\\s*[:=]\\s*)(["'])([^"']*)(["'])`,
  "gi"
);

const REDACTED = "[REDACTED]";

/**
 * Strip credential-bearing material from a URL, or from any string that may
 * contain one (an error message or a stack, for example). Values are replaced
 * rather than dropped so the log stays diagnostic.
 *
 * @param {any} value - A URL or an arbitrary string.
 * @returns {any} - The redacted string, or the value unchanged if not a string.
 */
function redactUrl(value) {
  if (typeof value !== "string") return value;

  return value
    .replace(SECRET_QUERY_PATTERN, `$1=${REDACTED}`)
    .replace(BASIC_AUTH_PATTERN, `$1${REDACTED}:${REDACTED}$4`)
    .replace(AUTH_SCHEME_PATTERN, `$1 ${REDACTED}`)
    .replace(JSON_SECRET_PATTERN, `$1$2${REDACTED}$4`);
}

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
function formatError(operation, error, context = {}) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${redactUrl(String(value))}`)
    .join(" ");

  const message = redactUrl(error?.message) ?? "unknown error";

  return `${operation}${details ? ` (${details})` : ""} [${getErrorStatus(error)}]: ${message}`;
}

function logError(operation, error, context = {}) {
  // safe-log-reviewed: formatError returns a redacted string, never the error itself
  console.error(formatError(operation, error, context));
}

/**
 * The same, at warning severity, for failures the caller recovers from.
 *
 * @param {string} operation - What was being attempted.
 * @param {any} error - The rejected value.
 * @param {Object} [context] - Extra key/value pairs to include.
 */
function logWarning(operation, error, context = {}) {
  // safe-log-reviewed: formatError returns a redacted string, never the error itself
  console.warn(formatError(operation, error, context));
}

module.exports = { getErrorStatus, logError, logWarning, formatError, redactUrl };
