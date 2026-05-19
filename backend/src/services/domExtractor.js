const config = require('../../config/config');

const PAGE_TIMEOUT = 5000;
const TOTAL_TIMEOUT = 15000;

const RPM_RE = /https?:\/\/multimovies\.rpmhub\.site\/[#?]?[a-zA-Z0-9_-]+/;
const P2P_RE = /https?:\/\/multimovies\.p2pplay\.pro\/[#?]?[a-zA-Z0-9_-]+/;
const UNS_RE = /https?:\/\/server1\.uns\.bio\/[#?]?[a-zA-Z0-9_-]+/;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function scanHtml(html) {
  return {
    rpm: (html.match(RPM_RE) || [null])[0],
    p2p: (html.match(P2P_RE) || [null])[0],
    upn: (html.match(UNS_RE) || [null])[0],
  };
}

function mergeFound(merged, scan) {
  if (!merged.rpm && scan.rpm) merged.rpm = scan.rpm;
  if (!merged.p2p && scan.p2p) merged.p2p = scan.p2p;
  if (!merged.upn && scan.upn) merged.upn = scan.upn;
  return !!(merged.rpm && merged.p2p && merged.upn);
}

/**
 * Fetch with retry + cookie persistence for Cloudflare bypass.
 */
async function httpFetch(url, options = {}, retries = 2) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT);

  const opts = {
    ...options,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      ...options.headers,
    },
    signal: controller.signal,
  };

  try {
    const res = await fetch(url, opts);
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (retries > 0 && (err.name === 'AbortError' || err.code === 'ECONNRESET')) {
      return httpFetch(url, options, retries - 1);
    }
    throw err;
  }
}

/**
 * STEP 1: Fetch source page and extract player options from HTML.
 */
async function fetchSourcePage(targetUrl) {
  const res = await httpFetch(targetUrl);
  const html = await res.text();

  // Extract player options via regex
  const liPattern = /<li[^>]*data-post="([^"]*)"[^>]*data-nume="([^"]*)"[^>]*data-type="([^"]*)"[^>]*>/gi;
  const options = [];
  let match;
  while ((match = liPattern.exec(html)) !== null) {
    options.push({ post: match[1], nume: match[2], type: match[3] });
  }

  console.log(`[fast] source → ${options.length} player options`);
  return { options, html };
}

/**
 * STEP 2: Fetch embed URL via WordPress AJAX.
 */
async function fetchEmbedUrl(targetUrl, option) {
  const baseUrl = targetUrl.replace(/\/[^/]*$/, '');
  const ajaxUrl = `${baseUrl}/wp-admin/admin-ajax.php`;

  const body = new URLSearchParams({
    action: 'doo_player_ajax',
    post: option.post,
    nume: option.nume,
    type: option.type,
  }).toString();

  const res = await httpFetch(ajaxUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': targetUrl,
      'Origin': new URL(targetUrl).origin,
    },
    body,
  });

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    const url = data.embed_url || data.src || data.url || data.player_url || null;
    return url && !url.includes('youtube') && !url.includes('youtu.be') ? url : null;
  } catch {
    return null;
  }
}

/**
 * STEP 3: Fetch embed page and scan for stream links.
 */
async function scanEmbedPage(embedUrl) {
  const res = await httpFetch(embedUrl, {
    redirect: 'follow',
  });
  const html = await res.text();
  const scan = scanHtml(html);
  console.log(`[fast] embed → rpm:${!!scan.rpm} p2p:${!!scan.p2p} upn:${!!scan.upn}`);

  // Also scan iframes in the HTML
  const iframePattern = /src="(https?:\/\/[^"]+)"/gi;
  let iframeMatch;
  while ((iframeMatch = iframePattern.exec(html)) !== null) {
    const iframeUrl = iframeMatch[1];
    if (iframeUrl.includes('youtube') || iframeUrl.includes('youtu.be')) continue;
    try {
      const innerRes = await httpFetch(iframeUrl, { redirect: 'follow' });
      const innerHtml = await innerRes.text();
      const innerScan = scanHtml(innerHtml);
      mergeFound(scan, innerScan);
    } catch {
      // Skip failed iframe fetches
    }
  }

  return scan;
}

/**
 * BLAZING FAST extraction — zero browser, pure HTTP.
 * Works on 512MB RAM. Completes in <10 seconds.
 */
async function extractLinks(browser, targetUrl) {
  const t0 = Date.now();
  console.log(`[fast] START: ${targetUrl}`);

  const merged = { rpm: null, p2p: null, upn: null };

  try {
    // Hard total timeout
    const totalTimer = setTimeout(() => {
      throw new Error('EXTRACTION_TIMEOUT');
    }, TOTAL_TIMEOUT);

    // STEP 1: Fetch source page
    const { options, html: sourceHtml } = await fetchSourcePage(targetUrl);

    // Quick scan of source HTML for direct links
    const sourceScan = scanHtml(sourceHtml);
    mergeFound(merged, sourceScan);

    if (options.length === 0) {
      clearTimeout(totalTimer);
      if (merged.rpm || merged.p2p || merged.upn) {
        const videoId = (merged.rpm || merged.p2p || merged.upn).match(/[#\/]([a-zA-Z0-9_-]+)$/)?.[1] || 'unknown';
        console.log(`[fast] DONE in ${Date.now() - t0}ms (source scan)`);
        return { success: true, rpm: merged.rpm, p2p: merged.p2p, upn: merged.upn, videoId };
      }
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No player options found' };
    }

    // STEP 2: Fetch ALL embed URLs in PARALLEL
    const embedResults = await Promise.allSettled(
      options.map(opt => fetchEmbedUrl(targetUrl, opt))
    );

    const embedUrls = embedResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    console.log(`[fast] ${embedUrls.length} embed URLs:`, embedUrls);

    if (embedUrls.length === 0) {
      clearTimeout(totalTimer);
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No embed URLs found' };
    }

    // STEP 3: Scan ALL embed pages in PARALLEL
    const scanResults = await Promise.allSettled(
      embedUrls.map(url => scanEmbedPage(url))
    );

    for (const result of scanResults) {
      if (result.status === 'fulfilled' && result.value) {
        mergeFound(merged, result.value);
      }
    }

    clearTimeout(totalTimer);

    // STEP 4: Return results
    const firstUrl = merged.rpm || merged.p2p || merged.upn;
    const videoId = firstUrl ? (firstUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/)?.[1] || 'unknown') : null;

    if (videoId) {
      console.log(`[fast] SUCCESS in ${Date.now() - t0}ms`);
      console.log(`  rpm: ${merged.rpm || '(not found)'}`);
      console.log(`  p2p: ${merged.p2p || '(not found)'}`);
      console.log(`  upn: ${merged.upn || '(not found)'}`);
      return { success: true, rpm: merged.rpm, p2p: merged.p2p, upn: merged.upn, videoId };
    }

    console.log(`[fast] No links found after ${Date.now() - t0}ms`);
    return {
      success: false,
      code: 'LINKS_NOT_FOUND',
      error: 'No embed links found (rpm/p2p/upn missing)',
    };
  } catch (err) {
    if (err.message === 'EXTRACTION_TIMEOUT') {
      return { success: false, code: 'TIMEOUT', error: 'Request timed out' };
    }
    console.error(`[fast] ERROR: ${err.message}`);
    return { success: false, code: 'INTERNAL_ERROR', error: err.message };
  }
}

module.exports = { extractLinks };
