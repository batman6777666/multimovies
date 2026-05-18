const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function log(step, msg) {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[${ts}] [${step}] ${msg}`);
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function extractLinks(targetUrl) {
  log('INIT', `Starting extraction for: ${targetUrl}`);
  const t0 = Date.now();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript-harmony-shipping',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    // STEP 1: Load target page
    log('STEP1', 'Loading target page...');
    const t1 = Date.now();
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setCacheEnabled(false);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'stylesheet' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {});

    const loadTime = Date.now() - t1;
    log('STEP1', `Page loaded in ${loadTime}ms | Status: ${response.status()}`);

    // STEP 2: Find embed iframe URL
    log('STEP2', 'Searching for embed iframe...');
    const t2 = Date.now();

    let embedIframeUrl = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.includes('embed') && iframe.src.startsWith('http')) {
          return iframe.src;
        }
      }
      return null;
    });

    log('STEP2', `Found embed iframe: ${embedIframeUrl || 'NOT FOUND'} (${Date.now() - t2}ms)`);

    // If no embed iframe, try DooPlayer AJAX
    if (!embedIframeUrl) {
      log('STEP2b', 'Trying DooPlayer AJAX call...');
      const ajaxResult = await page.evaluate(async () => {
        const playerOption = document.querySelector('#playeroptionsul li[data-post][data-nume][data-type]');
        if (!playerOption) return null;

        const params = new URLSearchParams();
        params.append('action', 'doo_player_ajax');
        params.append('post', playerOption.dataset.post);
        params.append('nume', playerOption.dataset.nume);
        params.append('type', playerOption.dataset.type);

        try {
          const res = await fetch('https://multimovies.fyi/wp-admin/admin-ajax.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });
          const data = await res.json();
          return data.embed_url || null;
        } catch (e) {
          return null;
        }
      });

      if (ajaxResult) {
        embedIframeUrl = ajaxResult;
        log('STEP2b', `AJAX returned embed URL: ${embedIframeUrl}`);
      }
    }

    if (!embedIframeUrl) {
      log('ERROR', 'No embed iframe found');
      return {
        success: false,
        error: 'No embed iframe found on this page',
        links: { rpm: null, p2p: null, upn: null },
        videoId: 'unknown',
      };
    }

    // STEP 3: Navigate to embed page
    log('STEP3', `Loading embed page: ${embedIframeUrl}`);
    const t3 = Date.now();
    const embedPage = await browser.newPage();
    await embedPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await embedPage.setCacheEnabled(false);

    await embedPage.setRequestInterception(true);
    embedPage.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'stylesheet' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    await embedPage.goto(embedIframeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await embedPage.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    log('STEP3', `Embed page loaded in ${Date.now() - t3}ms`);

    // STEP 4: Find inner iframe (pro.iqsmartgames.com/evid/...)
    log('STEP4', 'Searching for inner iframe...');
    const t4 = Date.now();

    let innerIframeUrl = await embedPage.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.startsWith('http') && iframe.id === 'player') {
          return iframe.src;
        }
      }
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.startsWith('http')) {
          return iframe.src;
        }
      }
      return null;
    });

    log('STEP4', `Found inner iframe: ${innerIframeUrl || 'NOT FOUND'} (${Date.now() - t4}ms)`);

    // If no inner iframe, check for direct data-link attributes
    if (!innerIframeUrl) {
      log('STEP4b', 'Checking for direct data-link attributes on embed page...');
      const directLinks = await embedPage.evaluate(() => {
        const elements = document.querySelectorAll('[data-link]');
        const links = {};
        for (const el of elements) {
          const link = el.getAttribute('data-link');
          const key = el.getAttribute('data-source-key');
          if (link && key) links[key] = link;
        }
        return links;
      });

      if (Object.keys(directLinks).length > 0) {
        log('STEP4b', `Found ${Object.keys(directLinks).length} direct links`);
        const rpmLink = directLinks.rpmshre || directLinks.rpm || null;
        const p2pLink = directLinks.strmp2 || directLinks.p2p || null;
        const upnLink = directLinks.upnshr || directLinks.upn || null;
        const foundCount = [rpmLink, p2pLink, upnLink].filter(Boolean).length;

        let videoId = 'unknown';
        if (rpmLink) {
          const idMatch = rpmLink.match(/[#\/]([a-zA-Z0-9_-]+)$/);
          if (idMatch) videoId = idMatch[1];
        }

        const totalTime = Date.now() - t0;
        log('DONE', `Extracted ${foundCount}/3 links in ${totalTime}ms`);

        return {
          success: true,
          videoId,
          links: { rpm: rpmLink, p2p: p2pLink, upn: upnLink },
          foundCount,
          totalCount: 3,
          allLinks: directLinks,
          timeMs: totalTime,
        };
      }

      log('ERROR', 'No inner iframe or direct links found');
      return {
        success: false,
        error: 'No inner iframe found on embed page',
        links: { rpm: null, p2p: null, upn: null },
        videoId: 'unknown',
      };
    }

    // STEP 5: Navigate to inner iframe page
    log('STEP5', `Loading inner iframe page: ${innerIframeUrl}`);
    const t5 = Date.now();
    const innerPage = await browser.newPage();
    await innerPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await innerPage.setCacheEnabled(false);

    await innerPage.setRequestInterception(true);
    innerPage.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'stylesheet' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    await innerPage.goto(innerIframeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await innerPage.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    log('STEP5', `Inner page loaded in ${Date.now() - t5}ms`);

    // STEP 6: Extract real links from data-link attributes
    log('STEP6', 'Extracting server links from data-link attributes...');
    const t6 = Date.now();

    const serverLinks = await innerPage.evaluate(() => {
      const elements = document.querySelectorAll('[data-link]');
      const links = {};
      for (const el of elements) {
        const link = el.getAttribute('data-link');
        const key = el.getAttribute('data-source-key');
        if (link && key) links[key] = link;
      }
      return links;
    });

    // Also search full HTML for RPM/P2P/UPN patterns as fallback
    const fullHtml = await innerPage.evaluate(() => document.documentElement.outerHTML);

    const rpmPattern = /https?:\/\/multimovies\.rpmhub\.site\/[#\/]([a-zA-Z0-9_-]+)/gi;
    const p2pPattern = /https?:\/\/multimovies\.p2pplay\.pro\/[#\/]([a-zA-Z0-9_-]+)/gi;
    const upnPattern = /https?:\/\/server1\.uns\.bio\/[#\/]([a-zA-Z0-9_-]+)/gi;

    const rpmMatch = fullHtml.match(rpmPattern);
    const p2pMatch = fullHtml.match(p2pPattern);
    const upnMatch = fullHtml.match(upnPattern);

    const rpmLink = serverLinks.rpmshre || (rpmMatch ? rpmMatch[0] : null);
    const p2pLink = serverLinks.strmp2 || (p2pMatch ? p2pMatch[0] : null);
    const upnLink = serverLinks.upnshr || (upnMatch ? upnMatch[0] : null);

    const foundCount = [rpmLink, p2pLink, upnLink].filter(Boolean).length;

    let videoId = 'unknown';
    if (rpmLink) {
      const idMatch = rpmLink.match(/[#\/]([a-zA-Z0-9_-]+)$/);
      if (idMatch) videoId = idMatch[1];
    }

    log('STEP6', `Extracted in ${Date.now() - t6}ms`);
    log('RESULT', `RPM: ${rpmLink}`);
    log('RESULT', `P2P: ${p2pLink}`);
    log('RESULT', `UPN: ${upnLink}`);

    const totalTime = Date.now() - t0;
    log('DONE', `Total extraction time: ${totalTime}ms`);

    return {
      success: foundCount > 0,
      videoId,
      links: {
        rpm: rpmLink,
        p2p: p2pLink,
        upn: upnLink,
      },
      foundCount,
      totalCount: 3,
      allLinks: serverLinks,
      timeMs: totalTime,
      debug: {
        targetUrl,
        embedIframeUrl,
        innerIframeUrl,
      },
    };
  } catch (error) {
    log('ERROR', `Extraction failed: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

app.post('/api/extract-links', async (req, res) => {
  log('API', `POST /api/extract-links | Body: ${JSON.stringify(req.body)}`);
  const t0 = Date.now();

  try {
    const { url } = req.body;

    if (!url) {
      log('API', 'ERROR: No URL provided');
      return res.status(400).json({ success: false, error: 'Please provide a URL' });
    }

    if (!isValidUrl(url)) {
      log('API', `ERROR: Invalid URL format: ${url}`);
      return res.status(400).json({ success: false, error: 'Please enter a valid URL (must start with http:// or https://)' });
    }

    log('API', `Valid URL, starting extraction...`);
    const result = await extractLinks(url);

    if (!result.success) {
      log('API', `Result: FAILED | ${result.error}`);
      return res.status(404).json({
        success: false,
        error: result.error || 'No RPM/P2P/UPN links found on this page',
        partial: result.foundCount > 0,
        links: result.links,
        videoId: result.videoId,
      });
    }

    log('API', `Result: SUCCESS | ${result.foundCount}/3 links | ${result.timeMs}ms`);
    res.json(result);
  } catch (error) {
    log('API', `CRASH: ${error.message}`);

    if (error.message.includes('timeout') || error.message.includes('time')) {
      return res.status(408).json({ success: false, error: 'Request timed out. Page may be too slow or unreachable.' });
    }

    if (error.message.includes('net::')) {
      return res.status(400).json({ success: false, error: 'Could not access the page. Check the URL and try again.' });
    }

    res.status(500).json({ success: false, error: 'An unexpected error occurred. Please try again.' });
  }
});

app.get('/', (req, res) => {
  log('API', 'GET / | Serving frontend');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('  VIDEO EMBED LINK EXTRACTOR');
  console.log(`  Running at http://localhost:${PORT}`);
  console.log('========================================');
  console.log('');
});
