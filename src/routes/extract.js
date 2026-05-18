const express = require('express');

const router = express.Router();
const { normalizeName, buildUrl } = require('../services/normalizer');
const { withBrowser } = require('../services/browserPool');
const { extractLinks } = require('../services/domExtractor');
const { get: cacheGet, set: cacheSet } = require('../services/cache');
const { ERROR_CODES } = require('../utils/constants');
const config = require('../../config/config');

// ─── POST /v1/extract ─────────────────────────────────────────────────────────

router.post('/extract', async (req, res) => {
  const t0 = Date.now();
  const { type, name, season, episode } = req.body;

  // ── Validate ────────────────────────────────────────────────────────────────

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: name',
      code: ERROR_CODES.MISSING_NAME,
    });
  }

  if (!type || !['movie', 'series'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Field "type" must be "movie" or "series"',
      code: ERROR_CODES.INVALID_TYPE,
    });
  }

  let parsedSeason = 1;
  let parsedEpisode = 1;

  if (type === 'series') {
    const rawSeason = parseInt(season, 10);
    const rawEpisode = parseInt(episode, 10);

    if (rawSeason >= 1) parsedSeason = rawSeason;
    if (rawEpisode >= 1) parsedEpisode = rawEpisode;
  }

  // ── Normalize + build URL ───────────────────────────────────────────────────

  const originalName = name.trim();
  const normalizedName = normalizeName(originalName);
  const sourceUrl = buildUrl(type, normalizedName, parsedSeason, parsedEpisode);
  console.log(`[extract] name="${originalName}" normalized="${normalizedName}" season=${parsedSeason} episode=${parsedEpisode} url="${sourceUrl}"`);

  // ── Cache check ─────────────────────────────────────────────────────────────

  const cacheKey = `links:${sourceUrl}`;
  const cached = await cacheGet(cacheKey);

  if (cached) {
    return res.json({
      success: true,
      request_time_ms: Date.now() - t0,
      cached: true,
      data: {
        type,
        original_name: originalName,
        normalized_name: normalizedName,
        source_url: sourceUrl,
        videoId: cached.videoId,
        links: cached.links,
        generated_at: new Date().toISOString(),
      },
    });
  }

  // ── Extract (with hard timeout) ─────────────────────────────────────────────

  let result;

  try {
    result = await Promise.race([
      withBrowser((browser) => extractLinks(browser, sourceUrl)),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('EXTRACTION_TIMEOUT')),
          config.TOTAL_REQUEST_TIMEOUT_MS
        )
      ),
    ]);
  } catch (err) {
    if (err.message === 'EXTRACTION_TIMEOUT') {
      return res.status(408).json({
        success: false,
        error: 'Request timed out. Source page may be slow or unreachable.',
        code: ERROR_CODES.TIMEOUT,
      });
    }

    console.error('[Extract] Unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred',
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  // ── Handle extraction failure ───────────────────────────────────────────────

  if (!result.success) {
    const statusMap = {
      SOURCE_NOT_FOUND: 404,
      LINKS_NOT_FOUND: 422,
    };
    return res.status(statusMap[result.code] || 500).json({
      success: false,
      error: result.error,
      code: result.code,
    });
  }

  // ── Use real extracted URLs (never template-reconstructed) ──────────────────

  const links = {
    rpm: result.rpm || null,
    p2p: result.p2p || null,
    upn: result.upn || null,
  };

  await cacheSet(cacheKey, { videoId: result.videoId, links });

  return res.json({
    success: true,
    request_time_ms: Date.now() - t0,
    cached: false,
    data: {
      type,
      original_name: originalName,
      normalized_name: normalizedName,
      source_url: sourceUrl,
      videoId: result.videoId,
      links,
      generated_at: new Date().toISOString(),
    },
  });
});

module.exports = router;
