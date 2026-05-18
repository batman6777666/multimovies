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

    await page.waitForSelector('#playeroptionsul li[data-post]', { timeout: 5000 }).catch(() => {});
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
      { timeout: 5000 }
    ).catch(() => {});

    // Give JS a moment to finish rendering
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

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
// Searches EVERY element attribute + text content for RPM/P2P/UPN URLs

async function extractRealUrlsFromDom(page) {
  const result = { rpm: null, p2p: null, upn: null, videoId: null };

  // Sweep all elements for URLs in any attribute or text
  const sweep = await page.evaluate(() => {
    const urls = { rpm: null, p2p: null, upn: null };
    const allElements = document.querySelectorAll('*');

    for (const el of allElements) {
      for (const attr of el.attributes) {
        const val = attr.value;
        if (val.includes('rpmhub') && !urls.rpm) urls.rpm = val;
        if (val.includes('p2pplay') && !urls.p2p) urls.p2p = val;
        if (val.includes('uns.bio') && !urls.upn) urls.upn = val;
      }
      if (el.textContent) {
        const text = el.textContent;
        if (!urls.rpm && text.includes('rpmhub')) {
          const m = text.match(/https?:\/\/[^\s"'<>]*rpmhub[^\s"'<>]*/);
          if (m) urls.rpm = m[0];
        }
        if (!urls.p2p && text.includes('p2pplay')) {
          const m = text.match(/https?:\/\/[^\s"'<>]*p2pplay[^\s"'<>]*/);
          if (m) urls.p2p = m[0];
        }
        if (!urls.upn && text.includes('uns.bio')) {
          const m = text.match(/https?:\/\/[^\s"'<>]*uns\.bio[^\s"'<>]*/);
          if (m) urls.upn = m[0];
        }
      }
    }
    return urls;
  });

  // Check #vidFrame iframe src
  const vidFrameSrc = await page.evaluate(() => {
    const frame = document.querySelector('#vidFrame');
    return frame && frame.src && frame.src.startsWith('http') ? frame.src : null;
  });

  // Check li.server-item data-link
  const serverLinks = await page.evaluate(() => {
    const links = {};
    document.querySelectorAll('li.server-item[data-link][data-source-key]').forEach(el => {
      links[el.dataset.sourceKey] = el.dataset.link;
    });
    return links;
  });

  const rpmLink = serverLinks.rpmshre || serverLinks.rpm || serverLinks.rpmshare || null;
  const p2pLink = serverLinks.strmp2 || serverLinks.p2p || serverLinks.p2pplay || serverLinks.strm || null;
  const upnLink = serverLinks.upnshr || serverLinks.upn || serverLinks.upnshare || null;

  // Priority: vidFrame > sweep > server-links
  if (vidFrameSrc) {
    console.log(`[vidFrame] ${vidFrameSrc}`);
    if (vidFrameSrc.includes('rpmhub')) result.rpm = vidFrameSrc;
    else if (vidFrameSrc.includes('p2pplay')) result.p2p = vidFrameSrc;
    else if (vidFrameSrc.includes('uns.bio')) result.upn = vidFrameSrc;
  }

  if (!result.rpm && sweep.rpm) { result.rpm = sweep.rpm; console.log(`[sweep] rpm: ${sweep.rpm}`); }
  if (!result.p2p && sweep.p2p) { result.p2p = sweep.p2p; console.log(`[sweep] p2p: ${sweep.p2p}`); }
  if (!result.upn && sweep.upn) { result.upn = sweep.upn; console.log(`[sweep] upn: ${sweep.upn}`); }

  if (!result.rpm && rpmLink) { result.rpm = rpmLink; console.log(`[server-item] rpm: ${rpmLink}`); }
  if (!result.p2p && p2pLink) { result.p2p = p2pLink; console.log(`[server-item] p2p: ${p2pLink}`); }
  if (!result.upn && upnLink) { result.upn = upnLink; console.log(`[server-item] upn: ${upnLink}`); }

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

      // Find evid iframe URL on embed page
      const evidUrl = await embedPage.evaluate(() => {
        for (const f of document.querySelectorAll('iframe')) {
          if (f.src && f.src.includes('evid') && f.src.startsWith('http')) return f.src;
        }
        for (const f of document.querySelectorAll('iframe')) {
          if (f.src && f.src.startsWith('http')) return f.src;
        }
        return null;
      });

      if (!evidUrl) {
        console.log(`[extractLinks] No iframe found on embed page`);
        continue;
      }
      console.log(`[extractLinks] Found iframe: ${evidUrl}`);

      // Navigate to evid page
      const { page: evidPage } = await loadEmbedPage(browser, evidUrl);
      pages.push(evidPage);

      // Extract real URLs from fully rendered DOM
      const realUrls = await extractRealUrlsFromDom(evidPage);
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
