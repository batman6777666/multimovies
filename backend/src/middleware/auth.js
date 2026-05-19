const { validateKey, trackUsage } = require('../services/keyStore');
const { ERROR_CODES } = require('../utils/constants');

/**
 * Validates X-API-Key header against the live key store.
 * Tracks usage on every successful request.
 */
function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Missing API key. Add header: X-API-Key: your_key',
      code: ERROR_CODES.INVALID_API_KEY,
    });
  }

  const record = validateKey(apiKey);

  if (!record) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or revoked API key',
      code: ERROR_CODES.INVALID_API_KEY,
    });
  }

  // Attach key info to request for downstream use
  req.apiKey = apiKey;
  req.apiKeyRecord = record;

  // Track usage async — don't block the request
  setImmediate(() => trackUsage(apiKey));

  next();
}

module.exports = authMiddleware;
