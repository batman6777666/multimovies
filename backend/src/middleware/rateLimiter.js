const rateLimit = require('express-rate-limit');
const config = require('../../config/config');
const { ERROR_CODES } = require('../utils/constants');

/**
 * Per-API-key rate limiter.
 * Falls back to IP if key is somehow absent (shouldn't happen — auth runs first).
 */
const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: `Rate limit exceeded: ${config.RATE_LIMIT_MAX} requests per ${config.RATE_LIMIT_WINDOW_MS / 1000}s`,
      code: ERROR_CODES.RATE_LIMITED,
    });
  },
});

module.exports = rateLimiter;
