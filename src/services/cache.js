const config = require('../../config/config');

/**
 * Dual-layer cache:
 *   1. Redis (if REDIS_URL is set and connection succeeds)
 *   2. In-memory Map fallback (always works, no extra deps)
 *
 * Both layers expose the same get/set interface.
 */

let redisClient = null;

// In-memory fallback store: key → { value, expiresAt }
const memStore = new Map();

// ─── Redis init ───────────────────────────────────────────────────────────────

async function initCache() {
  if (!config.REDIS_URL) {
    console.log('[Cache] No REDIS_URL — using in-memory cache.');
    return;
  }

  try {
    const { createClient } = require('redis');
    redisClient = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy: false, // Fail once — no infinite retry loop
      },
    });

    redisClient.on('error', (err) => {
      // Log once then disable — prevents console flood
      if (redisClient) {
        console.warn('[Cache] Redis unavailable — falling back to in-memory cache.');
        redisClient.quit().catch(() => {});
        redisClient = null;
      }
    });

    await redisClient.connect();
    console.log('[Cache] Redis connected.');
  } catch (err) {
    console.warn('[Cache] Redis init failed — using in-memory cache.');
    if (redisClient) {
      redisClient.quit().catch(() => {});
      redisClient = null;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function get(key) {
  try {
    if (redisClient?.isReady) {
      const raw = await redisClient.get(key);
      return raw ? JSON.parse(raw) : null;
    }

    const entry = memStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memStore.delete(key);
      return null;
    }
    return entry.value;
  } catch {
    return null; // cache miss — never crash the request
  }
}

async function set(key, value, ttlSeconds = config.CACHE_TTL_SECONDS) {
  try {
    if (redisClient?.isReady) {
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    }

    memStore.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  } catch {
    // cache write failure is non-fatal — log and move on
    console.error('[Cache] Failed to write key:', key);
  }
}

async function closeCache() {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
  }
  memStore.clear();
}

module.exports = { initCache, get, set, closeCache };
