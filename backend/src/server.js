require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('../config/config');
const { initPool, shutdownPool } = require('./services/browserPool');
const { initCache, closeCache } = require('./services/cache');
const extractRouter = require('./routes/extract');
const authRouter    = require('./routes/auth');
const authMiddleware = require('./middleware/auth');
const rateLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Public routes (no auth required) ───────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// Key registration — public, no API key needed
app.use('/auth', authRouter);

// Inspect endpoint — public, no API key needed
const inspectRouter = require('./routes/inspect');
app.use('/', inspectRouter);

// ─── Versioned API (API key required) ────────────────────────────────────────

app.use('/v1', authMiddleware, rateLimiter, extractRouter);

// ─── 404 catch-all ───────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found', code: 'NOT_FOUND' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    // Init cache first (fast — ms)
    await initCache();

    // Start listening immediately — don't block on browser pool
    app.listen(config.PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════╗');
      console.log('║   VIDEO EMBED LINK EXTRACTOR API v2.0   ║');
      console.log(`║   Port : ${String(config.PORT).padEnd(32)}║`);
      console.log(`║   Env  : ${String(config.NODE_ENV).padEnd(32)}║`);
      console.log('╚══════════════════════════════════════════╝');
      console.log('');
      console.log(`  Docs & Key Signup → http://localhost:${config.PORT}`);
      console.log(`  API Documentation → http://localhost:${config.PORT}/api-docs.html`);
      console.log(`  POST /auth/register  (get your API key)`);
      console.log(`  POST /v1/extract     (X-API-Key required)`);
      console.log(`  GET  /health         http://localhost:${config.PORT}/health`);
      console.log('');
      console.log('[Server] Warming up browser pool in background…');

      // Warm browsers after server is already accepting requests
      // withBrowser() handles lazy init if pool isn't ready yet
      initPool().then(() => {
        console.log('[Server] Browser pool ready. Full speed ahead.');
      }).catch((err) => {
        console.error('[Server] Browser pool failed to init:', err.message);
      });
    });
  } catch (err) {
    console.error('[FATAL] Server failed to start:', err.message);
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully…`);
  await Promise.allSettled([shutdownPool(), closeCache()]);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
