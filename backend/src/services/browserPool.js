const puppeteer = require('puppeteer');
const config = require('../../config/config');

/**
 * Browser pool — keeps N Chromium instances warm and reuses them.
 *
 * Acquire → do work → release.
 * If browser crashes, it is replaced transparently.
 * Callers that arrive when all slots are busy are queued and
 * served in FIFO order as soon as a slot is released.
 */

const pool = {
  slots: [],      // [{ browser, busy }]
  waitQueue: [],  // [resolve fn] waiting for a free slot
};

let initialized = false;
let initializing = false;

// ─── Internal helpers ────────────────────────────────────────────────────────

async function spawnBrowser() {
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  };

  // Use system Chromium in Docker environments
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  return puppeteer.launch(launchOptions);
}

async function acquireSlot() {
  const free = pool.slots.find((s) => !s.busy);
  if (free) {
    free.busy = true;
    return free;
  }
  // Queue the caller until a slot is released
  return new Promise((resolve) => {
    pool.waitQueue.push(resolve);
  });
}

function releaseSlot(slot) {
  if (pool.waitQueue.length > 0) {
    // Hand off directly to the next waiter — keep slot marked busy
    const next = pool.waitQueue.shift();
    next(slot);
  } else {
    slot.busy = false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function initPool() {
  if (initialized || initializing) return;
  initializing = true;

  const size = config.BROWSER_POOL_SIZE;
  console.log(`[BrowserPool] Spawning ${size} browser instance(s)…`);

  const browsers = await Promise.all(
    Array.from({ length: size }, () => spawnBrowser())
  );

  for (const browser of browsers) {
    pool.slots.push({ browser, busy: false });
  }

  initialized = true;
  initializing = false;
  console.log(`[BrowserPool] ${size} browser(s) ready.`);
}

/**
 * Runs `fn(browser)` with a pooled browser instance.
 * Automatically replaces a crashed browser.
 * Always releases the slot — even on error.
 */
async function withBrowser(fn) {
  if (!initialized) await initPool();

  const slot = await acquireSlot();

  try {
    // Silently replace dead browsers
    if (!slot.browser.isConnected()) {
      console.warn('[BrowserPool] Replacing disconnected browser…');
      try { await slot.browser.close(); } catch { /* ignore */ }
      slot.browser = await spawnBrowser();
    }

    return await fn(slot.browser);
  } finally {
    releaseSlot(slot);
  }
}

async function shutdownPool() {
  console.log('[BrowserPool] Shutting down…');
  await Promise.allSettled(pool.slots.map((s) => s.browser.close()));
  pool.slots = [];
  pool.waitQueue = [];
  initialized = false;
  initializing = false;
}

module.exports = { initPool, withBrowser, shutdownPool };
