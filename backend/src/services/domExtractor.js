const { STREAM_PATTERNS, BLOCKED_RESOURCE_TYPES, BLOCKED_URL_PATTERNS, EMBED_ATTRIBUTES } = require('../utils/constants');
const config = require('../../config/config');

const TIMEOUT = config.PAGE_LOAD_TIMEOUT_MS;
const TOTAL_TIMEOUT = config.TOTAL_REQUEST_TIMEOUT_MS;

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
    const url = req.url();
    if (BLOCKED_URL_PATTERNS.some((p) => url.includes(p))) {
      req.abort();
      return;
    }
    req.continue();
  });

  return page;
}

// ─── Load page — source page variant (wait for player options) ───────────────

async function loadSourcePage(browser, url) {
  const page = await setupPage(browser);
  let status = 0;
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });
    status = response?.status() ?? 200;
    if (status === 0) return { page, status, ok: false };
    if (status === 403 || status === 451) return { page, status, ok: false };

    await page.waitForSelector('#playeroptionsul li[data-post]', { timeout: 8000 }).catch(() => {});
    return { page, status, ok: true };
  } catch (err) {
    if (err.message?.includes('timeout') || err.message?.includes('net::')) {
      return { page, status: 200, ok: true };
    }
    console.error('[loadSourcePage] Error:', err.message);
    return { page, status, ok: false };
  }
}

// ─── Load page — embed/evid variant (wait for full DOM render) ───────────────

async function loadEmbedPage(browser, url) {
  const page = await setupPage(browser);
  let status = 0;
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });
    status = response?.status() ?? 200;
    if (status === 0) return { page, status, ok: false };
    if (status === 403 || status === 451) return { page, status, ok: false };

    // Wait for the page to fully render its DOM (iframes, server-items, etc.)
    await page.waitForFunction(
      () => document.querySelectorAll('iframe').length > 0 ||
           document.querySelectorAll('li.server-item[data-link]').length > 0,
      { timeout: 8000 }
    ).catch(() => {});

    // Give JS a moment to finish rendering dynamic content
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    return { page, status, ok: true };
  } catch (err) {
    if (err.message?.includes('timeout') || err.message?.includes('net::')) {
      return { page, status: 200, ok: true };
    }
    console.error('[loadEmbedPage] Error:', err.message);
    return { page, status, ok: false };
  }
}

// ─── Extract real URLs from fully rendered DOM ───────────────────────────────
// Gets the ENTIRE page HTML and regex-extracts RPM/P2P/UPN links

async function extractRealUrlsFromDom(page) {
  const result = { rpm: null, p2p: null, upn: null, videoId: null };

  // Get the full rendered HTML
  const html = await page.content();

  // Regex extract URLs from the raw HTML
  const rpmMatch = html.match(/https?:\/\/multimovies\.rpmhub\.site\/[#?]?[a-zA-Z0-9_-]+/);
  const p2pMatch = html.match(/https?:\/\/multimovies\.p2pplay\.pro\/[#?]?[a-zA-Z0-9_-]+/);
  const upnMatch  = html.match(/https?:\/\/server1\.uns\.bio\/[#?]?[a-zA-Z0-9_-]+/);

  if (rpmMatch) { result.rpm = rpmMatch[0]; console.log(`[html] rpm: ${rpmMatch[0]}`); }
  if (p2pMatch) { result.p2p = p2pMatch[0]; console.log(`[html] p2p: ${p2pMatch[0]}`); }
  if (upnMatch)  { result.upn = upnMatch[0];  console.log(`[html] upn: ${upnMatch[0]}`); }

  // Fallback: check #vidFrame iframe src
  if (!result.rpm || !result.p2p || !result.upn) {
    const vidFrameSrc = await page.evaluate(() => {
      const frame = document.querySelector('#vidFrame');
      return frame && frame.src && frame.src.startsWith('http') ? frame.src : null;
    });
    if (vidFrameSrc) {
      console.log(`[vidFrame] ${vidFrameSrc}`);
      if (!result.rpm && vidFrameSrc.includes('rpmhub')) result.rpm = vidFrameSrc;
      if (!result.p2p && vidFrameSrc.includes('p2pplay')) result.p2p = vidFrameSrc;
      if (!result.upn && vidFrameSrc.includes('uns.bio')) result.upn = vidFrameSrc;
    }
  }

  // Fallback: check li.server-item data-link
  if (!result.rpm || !result.p2p || !result.upn) {
    const serverLinks = await page.evaluate(() => {
      const links = {};
      document.querySelectorAll('li.server-item[data-link][data-source-key]').forEach(el => {
        links[el.dataset.sourceKey] = el.dataset.link;
      });
      return links;
    });
    if (!result.rpm) { const l = serverLinks.rpmshre || serverLinks.rpm || serverLinks.rpmshare; if (l) { result.rpm = l; console.log(`[server-item] rpm: ${l}`); } }
    if (!result.p2p) { const l = serverLinks.strmp2 || serverLinks.p2p || serverLinks.p2pplay || serverLinks.strm; if (l) { result.p2p = l; console.log(`[server-item] p2p: ${l}`); } }
    if (!result.upn) { const l = serverLinks.upnshr || serverLinks.upn || serverLinks.upnshare; if (l) { result.upn = l; console.log(`[server-item] upn: ${l}`); } }
  }

  // Extract videoId from first found link
  const firstLink = result.rpm || result.p2p || result.upn;
  if (firstLink) {
    const match = firstLink.match(/[#\/]([a-zA-Z0-9_-]+)$/);
    if (match) result.videoId = match[1];
  }

  return result;
}

// ─── Get player options from source page ─────────────────────────────────────

async function getPlayerOptions(page) {
  return page.evaluate(() => {
    const items = document.querySelectorAll('#playeroptionsul li[data-post][data-nume][data-type]');
    return Array.from(items).map((el) => ({
      post: el.dataset.post,
      nume: el.dataset.nume,
      type: el.dataset.type,
    }));
  });
}

// ─── AJAX call from Node.js context with page cookies ────────────────────────

async function fetchEmbedUrlViaAjax(page, playerOption) {
  try {
    const cookies = await page.cookies('https://multimovies.fyi');
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const body = new URLSearchParams({
      action: 'doo_player_ajax',
      post: playerOption.post,
      nume: playerOption.nume,
      type: playerOption.type,
    }).toString();

    const res = await fetch('https://multimovies.fyi/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
        'Referer': page.url(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body,
    });

    const data = await res.json();
    const embedUrl = data.embed_url || data.src || data.url || data.player_url || null;
    console.log(`[AJAX] post=${playerOption.post} nume=${playerOption.nume} → ${embedUrl}`);
    return embedUrl;
  } catch (err) {
    console.error('[AJAX] Failed:', err.message);
    return null;
  }
}

// ─── Main extraction ─────────────────────────────────────────────────────────
// Chain: source → AJAX → embed page → evid iframe → evid page → extract from DOM

async function extractLinks(browser, targetUrl) {
  const startTime = Date.now();
  console.log(`[extractLinks] Starting: ${targetUrl}`);

  const pages = [];
  try {
    // Step 1: Load source page
    const { page: sourcePage, ok: sourceOk } = await loadSourcePage(browser, targetUrl);
    pages.push(sourcePage);

    if (!sourceOk) {
      return { success: false, code: 'SOURCE_NOT_FOUND', error: 'Source page not accessible' };
    }

    // Step 2: Get player options
    const options = await getPlayerOptions(sourcePage);
    console.log(`[extractLinks] Found ${options.length} player options`);

    if (options.length === 0) {
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No player options found' };
    }

    // Step 3: Try each player option
    for (const opt of options) {
      console.log(`[extractLinks] Trying option ${opt.nume}...`);

      // AJAX to get embed URL
      const embedUrl = await fetchEmbedUrlViaAjax(sourcePage, opt);
      if (!embedUrl) continue;

      // Navigate to embed page
      const { page: embedPage } = await loadEmbedPage(browser, embedUrl);
      pages.push(embedPage);

      // Find iframe URL on embed page
      const iframeUrl = await embedPage.evaluate(() => {
        for (const f of document.querySelectorAll('iframe')) {
          if (f.src && f.src.startsWith('http')) return f.src;
        }
        return null;
      });

      if (!iframeUrl) {
        console.log(`[extractLinks] No iframe found on embed page`);
        continue;
      }
      console.log(`[extractLinks] Found iframe: ${iframeUrl}`);

      // If the iframe URL itself is an RPM/P2P/UPN link, use it directly
      if (iframeUrl.includes('rpmhub')) {
        const match = iframeUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/);
        console.log(`[extractLinks] SUCCESS (direct rpm) in ${Date.now() - startTime}ms`);
        return { success: true, rpm: iframeUrl, p2p: null, upn: null, videoId: match ? match[1] : null };
      }
      if (iframeUrl.includes('p2pplay')) {
        const match = iframeUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/);
        console.log(`[extractLinks] SUCCESS (direct p2p) in ${Date.now() - startTime}ms`);
        return { success: true, rpm: null, p2p: iframeUrl, upn: null, videoId: match ? match[1] : null };
      }
      if (iframeUrl.includes('uns.bio')) {
        const match = iframeUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/);
        console.log(`[extractLinks] SUCCESS (direct upn) in ${Date.now() - startTime}ms`);
        return { success: true, rpm: null, p2p: null, upn: iframeUrl, videoId: match ? match[1] : null };
      }

      // Otherwise navigate to the iframe page and extract from full HTML
      const { page: iframePage } = await loadEmbedPage(browser, iframeUrl);
      pages.push(iframePage);

      const realUrls = await extractRealUrlsFromDom(iframePage);
      if (realUrls.videoId) {
        console.log(`[extractLinks] SUCCESS in ${Date.now() - startTime}ms`);
        return { success: true, ...realUrls };
      }
    }

    console.log(`[extractLinks] No links found after ${Date.now() - startTime}ms`);
    return {
      success: false,
      code: 'LINKS_NOT_FOUND',
      error: 'No embed links found (rpm/p2p/upn missing)',
    };
  } finally {
    await Promise.allSettled(pages.map((p) => p.close()));
  }
}

module.exports = { extractLinks };
