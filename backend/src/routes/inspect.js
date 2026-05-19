const express = require('express');
const router = express.Router();
const { withBrowser } = require('../services/browserPool');
const { extractLinks } = require('../services/domExtractor');
const { get: cacheGet, set: cacheSet } = require('../services/cache');
const config = require('../../config/config');

// ─── POST /inspect (no auth — for frontend UI) ────────────────────────────────

router.post('/inspect', async (req, res) => {
  const t0 = Date.now();
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Missing required field: url',
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid URL format',
    });
  }

  const cacheKey = `inspect:${url.trim()}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return res.json({
      success: true,
      url: url.trim(),
      results: cached,
      cached: true,
      request_time_ms: Date.now() - t0,
    });
  }

  let result;
  try {
    result = await Promise.race([
      withBrowser((browser) => extractLinks(browser, url.trim())),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), config.TOTAL_REQUEST_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    if (err.message === 'EXTRACTION_TIMEOUT') {
      return res.status(408).json({
        success: false,
        message: 'Request timed out. Source page may be slow or unreachable.',
      });
    }
    console.error('[Inspect] Unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
    });
  }

  if (!result.success) {
    return res.status(422).json({
      success: false,
      message: result.error || 'No embed links found',
    });
  }

  const results = {
    rpm: result.rpm || null,
    p2p: result.p2p || null,
    upn: result.upn || null,
  };

  await cacheSet(cacheKey, results);

  return res.json({
    success: true,
    url: url.trim(),
    results,
    videoId: result.videoId,
    cached: false,
    request_time_ms: Date.now() - t0,
  });
});

module.exports = router;
