require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Comma-separated list of valid API keys
  API_KEYS: process.env.API_KEYS
    ? process.env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
    : [],

  REDIS_URL: process.env.REDIS_URL || null,
  CACHE_TTL_SECONDS: parseInt(process.env.CACHE_TTL_SECONDS || '3600', 10),

  BROWSER_POOL_SIZE: parseInt(process.env.BROWSER_POOL_SIZE || '5', 10),

  // Per-page load timeout (ms)
  PAGE_LOAD_TIMEOUT_MS: parseInt(process.env.PAGE_LOAD_TIMEOUT_MS || '10000', 10),

  // Hard ceiling for entire extraction pipeline (ms)
  TOTAL_REQUEST_TIMEOUT_MS: parseInt(process.env.TOTAL_REQUEST_TIMEOUT_MS || '30000', 10),

  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),

  NODE_ENV: process.env.NODE_ENV || 'development',
};
