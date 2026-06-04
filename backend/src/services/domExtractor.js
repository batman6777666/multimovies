const config = require('../../config/config');
const { STREAM_PATTERNS, LINK_TEMPLATES } = require('../utils/constants');

const PAGE_TIMEOUT = 10000;

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setCacheEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'stylesheet' || type === 'media') {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  return page;
}

async function extractLinks(browser, targetUrl) {
  const t0 = Date.now();
  console.log(`[fast] START: ${targetUrl}`);

  let page = null;

  try {
    if (!browser) {
      return { success: false, code: 'INTERNAL_ERROR', error: 'Browser required' };
    }

    page = await setupPage(browser);

    // Load source page with browser to bypass Cloudflare
    console.log('[fast] Loading source page...');
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    } catch (err) {
      console.log(`[fast] Page load note: ${err.message}`);
    }

    // Wait for Cloudflare to solve - poll for up to 20 seconds
    let cfSolved = false;
    for (let i = 0; i < 40; i++) {
      const title = await page.title();
      if (!title.includes('Just a moment') && !title.includes('Checking')) {
        cfSolved = true;
        console.log(`[cf] Solved in ${(i + 1) * 500}ms`);
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!cfSolved) {
      console.log('[cf] Not solved after 20s, trying anyway...');
    }

    // Wait for player options
    await page.waitForSelector('#playeroptionsul li[data-post]', { timeout: 5000 }).catch(() => {});

    // Get player options and make AJAX calls
    const result = await page.evaluate(async () => {
      const options = Array.from(document.querySelectorAll('#playeroptionsul li[data-post][data-nume][data-type]'))
        .map(el => ({ post: el.dataset.post, nume: el.dataset.nume, type: el.dataset.type }));

      const debug = [];
      const embedUrls = [];

      for (const opt of options) {
        try {
          const body = new URLSearchParams({
            action: 'doo_player_ajax',
            post: opt.post,
            nume: opt.nume,
            type: opt.type,
          }).toString();

          const res = await fetch('/wp-admin/admin-ajax.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          });
          const text = await res.text();
          debug.push({ opt, status: res.status, response: text.substring(0, 300) });

          try {
            const data = JSON.parse(text);
            const url = data.embed_url || data.src || data.url || data.player_url || null;
            if (url && !url.includes('youtube') && !url.includes('youtu.be')) {
              embedUrls.push(url);
            }
          } catch (parseErr) {
            debug[debug.length - 1].parseError = parseErr.message;
          }
        } catch (err) {
          debug.push({ opt, error: err.message });
        }
      }

      return { options: options.length, embedUrls, debug };
    });

    console.log(`[fast] ${result.options} options, ${result.embedUrls.length} embed URLs`);
    result.debug.forEach((d, i) => {
      if (d.error) {
        console.log(`[ajax][${i}] ERROR: ${d.error}`);
      } else {
        console.log(`[ajax][${i}] status=${d.status} opt=${JSON.stringify(d.opt)} body=${d.response}`);
        if (d.parseError) console.log(`[ajax][${i}] parseError: ${d.parseError}`);
      }
    });

    // Helper to find a video ID in any string
    const findVideoId = (text) => {
      if (!text) return null;
      for (const [patternName, pattern] of Object.entries(STREAM_PATTERNS)) {
        const match = text.match(pattern);
        if (match && match[1]) {
          console.log(`[extract] Matched pattern "${patternName}": ${match[0]} -> ID: ${match[1]}`);
          return match[1];
        }
      }
      return null;
    };

    let videoId = null;

    if (result.embedUrls.length === 0) {
      // Check source HTML for direct links
      const html = await page.content();
      videoId = findVideoId(html);
      if (videoId) {
        console.log(`[fast] DONE in ${Date.now() - t0}ms (source scan)`);
        return {
          success: true,
          rpm: LINK_TEMPLATES.rpm(videoId),
          p2p: LINK_TEMPLATES.p2p(videoId),
          upn: LINK_TEMPLATES.upn(videoId),
          videoId
        };
      }
      return { success: false, code: 'LINKS_NOT_FOUND', error: 'No embed URLs found' };
    }

    // First check if any of the embed URLs themselves contain the video ID
    for (const url of result.embedUrls) {
      videoId = findVideoId(url);
      if (videoId) {
        console.log(`[fast] Video ID found directly in embed URL: ${url}`);
        break;
      }
    }

    // If not found directly, load the embed URLs using Puppeteer to resolve dynamic iframes/requests
    if (!videoId) {
      console.log(`[fast] Resolving ${result.embedUrls.length} embed URLs dynamically in parallel...`);
      const pagePromises = result.embedUrls.map(async (embedUrl) => {
        let embedPage = null;
        try {
          embedPage = await setupPage(browser);
          let localVideoId = null;

          // Listen to frame navigation and attached frames
          embedPage.on('frameattached', (frame) => {
            const url = frame.url();
            if (url && url !== 'about:blank') {
              const matched = findVideoId(url);
              if (matched) localVideoId = matched;
            }
          });

          embedPage.on('framenavigated', (frame) => {
            const url = frame.url();
            if (url && url !== 'about:blank') {
              const matched = findVideoId(url);
              if (matched) localVideoId = matched;
            }
          });

          // Listen to request URLs
          embedPage.on('request', (req) => {
            const url = req.url();
            const matched = findVideoId(url);
            if (matched) localVideoId = matched;
          });

          // Navigate to embed page (wait only for domcontentloaded for speed)
          await embedPage.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});

          // Small sleep to let dynamic scripts run
          for (let tick = 0; tick < 10; tick++) {
            if (localVideoId) break;
            await new Promise(r => setTimeout(r, 200));
          }

          if (localVideoId) return localVideoId;

          // Also check standard DOM iframes in case events missed it
          const domIframes = await embedPage.evaluate(() => {
            return Array.from(document.querySelectorAll('iframe'))
              .map(f => f.src)
              .filter(Boolean);
          }).catch(() => []);

          for (const src of domIframes) {
            const matched = findVideoId(src);
            if (matched) return matched;
          }

          // Also check DOM content
          const content = await embedPage.content().catch(() => '');
          const matchedFromContent = findVideoId(content);
          if (matchedFromContent) return matchedFromContent;

          return null;
        } catch (err) {
          console.log(`[fast] Error loading embed ${embedUrl}: ${err.message}`);
          return null;
        } finally {
          if (embedPage) {
            try { await embedPage.close(); } catch {}
          }
        }
      });

      // Wait for all pages to resolve
      const resolvedIds = await Promise.all(pagePromises);
      videoId = resolvedIds.find(Boolean) || null;
    }

    if (videoId) {
      const rpm = LINK_TEMPLATES.rpm(videoId);
      const p2p = LINK_TEMPLATES.p2p(videoId);
      const upn = LINK_TEMPLATES.upn(videoId);

      console.log(`[fast] SUCCESS in ${Date.now() - t0}ms`);
      console.log(`  rpm: ${rpm}`);
      console.log(`  p2p: ${p2p}`);
      console.log(`  upn: ${upn}`);
      return { success: true, rpm, p2p, upn, videoId };
    }

    console.log(`[fast] No links found after ${Date.now() - t0}ms`);
    return { success: false, code: 'LINKS_NOT_FOUND', error: 'No embed links found' };
  } catch (err) {
    console.error(`[fast] ERROR: ${err.message}`);
    return { success: false, code: 'INTERNAL_ERROR', error: err.message };
  } finally {
    if (page) { try { await page.close(); } catch {} }
  }
}

module.exports = { extractLinks };
