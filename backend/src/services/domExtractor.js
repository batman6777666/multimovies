const { BLOCKED_RESOURCE_TYPES, BLOCKED_URL_PATTERNS } = require('../utils/constants');
const config = require('../../config/config');

const TIMEOUT = config.PAGE_LOAD_TIMEOUT_MS;
const TOTAL_TIMEOUT = config.TOTAL_REQUEST_TIMEOUT_MS;

const RPM_RE = /https?:\/\/multimovies\.rpmhub\.site\/[#?]?[a-zA-Z0-9_-]+/;
const P2P_RE = /https?:\/\/multimovies\.p2pplay\.pro\/[#?]?[a-zA-Z0-9_-]+/;
const UNS_RE = /https?:\/\/server1\.uns\.bio\/[#?]?[a-zA-Z0-9_-]+/;

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);

  page.on('request', (req) => {
    if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
      req.abort();
      return;
    }
    if (BLOCKED_URL_PATTERNS.some((p) => req.url().includes(p))) {
      req.abort();
      return;
    }
    req.continue();
  });

  return page;
}

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

async function loadAndScan(browser, url, merged, allPages) {
  const page = await setupPage(browser);
  allPages.push(page);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForFunction(
      () => document.querySelectorAll('li.server-item[data-link]').length > 0 ||
           document.querySelectorAll('iframe').length > 0,
      { timeout: 3000 }
    ).catch(() => {});
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    // Scan embed page HTML
    const html = await page.content();
    const scan = scanHtml(html);
    console.log(`[scan] ${url.substring(0, 50)}... → rpm:${!!scan.rpm} p2p:${!!scan.p2p} upn:${!!scan.upn}`);
    if (mergeFound(merged, scan)) return true;

    // Scan inner iframes
    const iframeUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => f.src)
        .filter(s => s && s.startsWith('http'));
    });

    for (const iframeUrl of iframeUrls) {
      if (merged.rpm && merged.p2p && merged.upn) return true;

      const innerPage = await setupPage(browser);
      allPages.push(innerPage);
      try {
        await innerPage.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
        await innerPage.waitForFunction(
          () => document.querySelectorAll('li.server-item[data-link]').length > 0 ||
               document.querySelectorAll('iframe').length > 0,
          { timeout: 3000 }
        ).catch(() => {});
        await innerPage.evaluate(() => new Promise(r => setTimeout(r, 500)));

        const innerHtml = await innerPage.content();
        const innerScan = scanHtml(innerHtml);
        console.log(`[scan-inner] ${iframeUrl.substring(0, 50)}... → rpm:${!!innerScan.rpm} p2p:${!!innerScan.p2p} upn:${!!innerScan.upn}`);
        if (mergeFound(merged, innerScan)) return true;
      } catch (err) {
        console.error('[scan-inner] Error:', err.message);
      }
    }
  } catch (err) {
    console.error('[scan] Error:', err.message);
  }

  return false;
}

/**
 * Fetches player options from the source page HTML using Node.js fetch.
 * Parses the HTML to find #playeroptionsul li elements with data attributes.
 */
async function fetchPlayerOptions(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const html = await res.text();

    // Extract player options from HTML using regex
    // Pattern: <li ... data-post="..." data-nume="..." data-type="..." ...>
    const liPattern = /<li[^>]*data-post="([^"]*)"[^>]*data-nume="([^"]*)"[^>]*data-type="([^"]*)"[^>]*>/gi;
    const options = [];
    let match;
    while ((match = liPattern.exec(html)) !== null) {
      options.push({
        post: match[1],
        nume: match[2],
        type: match[3],
      });
    }

    console.log(`[extractLinks] Fetched source page, found ${options.length} player options via regex`);
    return { options, html };
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[extractLinks] Failed to fetch source page: ${err.message}`);
    return { options: [], html: '' };
  }
}

/**
 * Makes AJAX call to WordPress admin-ajax.php directly from Node.js.
 */
async function fetchEmbedUrl(baseUrl, option) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const body = new URLSearchParams({
      action: 'doo_player_ajax',
      post: option.post,
      nume: option.nume,
      type: option.type,
    }).toString();

    const ajaxUrl = baseUrl.replace(/\/[^/]*$/, '') + '/wp-admin/admin-ajax.php';

    const res = await fetch(ajaxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': baseUrl,
        'Accept': '*/*',
        'Origin': new URL(baseUrl).origin,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text();
    console.log(`[extractLinks] AJAX[${option.type}/${option.nume}] status=${res.status} body=${text.substring(0, 200)}`);

    try {
      const data = JSON.parse(text);
      const url = data.embed_url || data.src || data.url || data.player_url || null;
      return url && !url.includes('youtube') && !url.includes('youtu.be') ? url : null;
    } catch {
      return null;
    }
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[extractLinks] AJAX[${option.type}/${option.nume}] failed: ${err.message}`);
    return null;
  }
}

async function extractLinks(browser, targetUrl) {
  const startTime = Date.now();
  console.log(`[extractLinks] Starting: ${targetUrl}`);

  const allPages = [];
  const merged = { rpm: null, p2p: null, upn: null };

  try {
    // STEP 1: Fetch source page HTML directly from Node.js (bypasses Cloudflare browser challenge)
    const { options, html: sourceHtml } = await fetchPlayerOptions(targetUrl);

    if (options.length === 0) {
      // Fallback: try scanning the HTML directly for RPM/P2P/UPN patterns
      const scan = scanHtml(sourceHtml);
      if (mergeFound(merged, scan)) {
        const videoId = (merged.rpm || merged.p2p || merged.upn)?.match(/[#\/]([a-zA-Z0-9_-]+)$/)?.[1] || 'unknown';
        return { success: true, rpm: merged.rpm, p2p: merged.p2p, upn: merged.upn, videoId };
      }
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No player options found' };
    }

    // STEP 2: Get embed URLs via AJAX directly from Node.js
    const embedUrls = [];
    for (const option of options) {
      const url = await fetchEmbedUrl(targetUrl, option);
      if (url) embedUrls.push(url);
    }

    console.log(`[extractLinks] ${embedUrls.length} valid embed URLs:`, embedUrls);

    if (embedUrls.length === 0) {
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No embed URLs found' };
    }

    // STEP 3: Load embed pages in browser and extract stream links
    for (const url of embedUrls) {
      if (merged.rpm && merged.p2p && merged.upn) break;
      const done = await loadAndScan(browser, url, merged, allPages);
      if (done) break;
    }

    // STEP 4: Return results
    const firstUrl = merged.rpm || merged.p2p || merged.upn;
    const videoId = firstUrl ? (firstUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/)?.[1] || 'unknown') : null;

    if (videoId) {
      console.log(`[extractLinks] SUCCESS in ${Date.now() - startTime}ms`);
      console.log(`  rpm: ${merged.rpm || '(not found)'}`);
      console.log(`  p2p: ${merged.p2p || '(not found)'}`);
      console.log(`  upn: ${merged.upn || '(not found)'}`);
      return { success: true, rpm: merged.rpm, p2p: merged.p2p, upn: merged.upn, videoId };
    }

    console.log(`[extractLinks] No links found after ${Date.now() - startTime}ms`);
    return {
      success: false,
      code: 'LINKS_NOT_FOUND',
      error: 'No embed links found (rpm/p2p/upn missing)',
    };
  } finally {
    await Promise.allSettled(allPages.map(p => p.close()));
  }
}

module.exports = { extractLinks };
