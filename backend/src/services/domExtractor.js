const { STREAM_PATTERNS, BLOCKED_RESOURCE_TYPES, BLOCKED_URL_PATTERNS, EMBED_ATTRIBUTES, LINK_TEMPLATES } = require('../utils/constants');
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

    await page.waitForFunction(
      () => document.querySelectorAll('iframe').length > 0 ||
           document.querySelectorAll('li.server-item[data-link]').length > 0,
      { timeout: 8000 }
    ).catch(() => {});

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

async function extractRealUrlsFromDom(page) {
  const result = { rpm: null, p2p: null, upn: null, videoId: null };

  const html = await page.content();

  const rpmMatch = html.match(/https?:\/\/multimovies\.rpmhub\.site\/[#?]?[a-zA-Z0-9_-]+/);
  const p2pMatch = html.match(/https?:\/\/multimovies\.p2pplay\.pro\/[#?]?[a-zA-Z0-9_-]+/);
  const upnMatch  = html.match(/https?:\/\/server1\.uns\.bio\/[#?]?[a-zA-Z0-9_-]+/);

  if (rpmMatch) { result.rpm = rpmMatch[0]; }
  if (p2pMatch) { result.p2p = p2pMatch[0]; }
  if (upnMatch)  { result.upn = upnMatch[0]; }

  if (!result.rpm || !result.p2p || !result.upn) {
    const vidFrameSrc = await page.evaluate(() => {
      const frame = document.querySelector('#vidFrame');
      return frame && frame.src && frame.src.startsWith('http') ? frame.src : null;
    });
    if (vidFrameSrc) {
      if (!result.rpm && vidFrameSrc.includes('rpmhub')) result.rpm = vidFrameSrc;
      if (!result.p2p && vidFrameSrc.includes('p2pplay')) result.p2p = vidFrameSrc;
      if (!result.upn && vidFrameSrc.includes('uns.bio')) result.upn = vidFrameSrc;
    }
  }

  if (!result.rpm || !result.p2p || !result.upn) {
    const serverLinks = await page.evaluate(() => {
      const links = {};
      document.querySelectorAll('li.server-item[data-link][data-source-key]').forEach(el => {
        links[el.dataset.sourceKey] = el.dataset.link;
      });
      return links;
    });
    if (!result.rpm) { const l = serverLinks.rpmshre || serverLinks.rpm || serverLinks.rpmshare; if (l) result.rpm = l; }
    if (!result.p2p) { const l = serverLinks.strmp2 || serverLinks.p2p || serverLinks.p2pplay || serverLinks.strm; if (l) result.p2p = l; }
    if (!result.upn) { const l = serverLinks.upnshr || serverLinks.upn || serverLinks.upnshare; if (l) result.upn = l; }
  }

  const firstLink = result.rpm || result.p2p || result.upn;
  if (firstLink) {
    const match = firstLink.match(/[#\/]([a-zA-Z0-9_-]+)$/);
    if (match) result.videoId = match[1];
  }

  return result;
}

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

async function resolveOnePlayerOption(browser, sourcePage, opt) {
  const embedUrl = await fetchEmbedUrlViaAjax(sourcePage, opt);
  if (!embedUrl) return { rpm: null, p2p: null, upn: null, videoId: null };

  const pages = [];
  try {
    const { page: embedPage } = await loadEmbedPage(browser, embedUrl);
    pages.push(embedPage);

    const iframeUrl = await embedPage.evaluate(() => {
      for (const f of document.querySelectorAll('iframe')) {
        if (f.src && f.src.startsWith('http')) return f.src;
      }
      return null;
    });

    if (!iframeUrl) return { rpm: null, p2p: null, upn: null, videoId: null };

    if (iframeUrl.includes('rpmhub')) {
      const match = iframeUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/);
      return { rpm: iframeUrl, p2p: null, upn: null, videoId: match ? match[1] : null };
    }
    if (iframeUrl.includes('p2pplay')) {
      const match = iframeUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/);
      return { rpm: null, p2p: iframeUrl, upn: null, videoId: match ? match[1] : null };
    }
    if (iframeUrl.includes('uns.bio')) {
      const match = iframeUrl.match(/[#\/]([a-zA-Z0-9_-]+)$/);
      return { rpm: null, p2p: null, upn: iframeUrl, videoId: match ? match[1] : null };
    }

    const { page: iframePage } = await loadEmbedPage(browser, iframeUrl);
    pages.push(iframePage);

    return await extractRealUrlsFromDom(iframePage);
  } catch (err) {
    console.error(`[resolvePlayer] option ${opt.nume} failed:`, err.message);
    return { rpm: null, p2p: null, upn: null, videoId: null };
  } finally {
    await Promise.allSettled(pages.map((p) => p.close()));
  }
}

async function extractLinks(browser, targetUrl) {
  const startTime = Date.now();
  console.log(`[extractLinks] Starting: ${targetUrl}`);

  const allPages = [];
  try {
    const { page: sourcePage, ok: sourceOk } = await loadSourcePage(browser, targetUrl);
    allPages.push(sourcePage);

    if (!sourceOk) {
      return { success: false, code: 'SOURCE_NOT_FOUND', error: 'Source page not accessible' };
    }

    const options = await getPlayerOptions(sourcePage);
    console.log(`[extractLinks] Found ${options.length} player options — racing for first videoId`);

    if (options.length === 0) {
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No player options found' };
    }

    return new Promise((resolve) => {
      let resolved = false;
      let completed = 0;
      const merged = { rpm: null, p2p: null, upn: null, videoId: null };

      for (const opt of options) {
        resolveOnePlayerOption(browser, sourcePage, opt).then((result) => {
          if (resolved) return;

          if (result.videoId) {
            merged.videoId = result.videoId;
            if (result.rpm) merged.rpm = result.rpm;
            if (result.p2p) merged.p2p = result.p2p;
            if (result.upn) merged.upn = result.upn;
          }

          if (!merged.videoId && result.videoId) {
            merged.videoId = result.videoId;
          }
          if (!merged.rpm && result.rpm) merged.rpm = result.rpm;
          if (!merged.p2p && result.p2p) merged.p2p = result.p2p;
          if (!merged.upn && result.upn) merged.upn = result.upn;

          if (merged.videoId && !resolved) {
            resolved = true;
            merged.rpm = merged.rpm || LINK_TEMPLATES.rpm(merged.videoId);
            merged.p2p = merged.p2p || LINK_TEMPLATES.p2p(merged.videoId);
            merged.upn = merged.upn || LINK_TEMPLATES.upn(merged.videoId);

            console.log(`[extractLinks] SUCCESS in ${Date.now() - startTime}ms`);
            console.log(`  rpm: ${merged.rpm}`);
            console.log(`  p2p: ${merged.p2p}`);
            console.log(`  upn: ${merged.upn}`);
            resolve({ success: true, ...merged });
          }

          completed++;
          if (completed === options.length && !resolved) {
            console.log(`[extractLinks] No links found after ${Date.now() - startTime}ms`);
            resolve({
              success: false,
              code: 'LINKS_NOT_FOUND',
              error: 'No embed links found (rpm/p2p/upn missing)',
            });
          }
        });
      }
    });
  } finally {
    await Promise.allSettled(allPages.map((p) => p.close()));
  }
}

module.exports = { extractLinks };
