import { getBrowser } from './browser';
import { extractPatterns, PatternResult } from './patterns';

export interface InspectResult {
  success: boolean;
  url: string;
  results: PatternResult;
  message?: string;
}

export async function inspectPage(targetUrl: string): Promise<InspectResult> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await page.waitForTimeout(5000);

    const allContent = await page.evaluate(() => {
      const parts: string[] = [];

      parts.push(document.documentElement.outerHTML);

      const scriptElements = Array.from(document.querySelectorAll('script'));
      parts.push(
        scriptElements
          .map((s: HTMLScriptElement) => s.textContent || s.innerHTML || '')
          .join('\n')
      );

      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const iframe of iframes) {
        const src = (iframe as HTMLIFrameElement).src;
        if (src) parts.push(src);
        try {
          const iframeDoc = (iframe as HTMLIFrameElement).contentDocument;
          if (iframeDoc) {
            parts.push(iframeDoc.documentElement.outerHTML);
          }
        } catch {}
      }

      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (
            attr.name === 'src' ||
            attr.name === 'href' ||
            attr.name === 'data-src' ||
            attr.name === 'data-href' ||
            attr.name === 'data-url' ||
            attr.name === 'data-link' ||
            attr.name === 'data-embed' ||
            attr.name === 'data-source' ||
            attr.name === 'data-stream' ||
            attr.name === 'data-video' ||
            attr.name === 'data-player' ||
            attr.name === 'value' ||
            attr.name === 'poster' ||
            attr.name === 'data'
          ) {
            parts.push(attr.value);
          }
        }
      }

      return parts.join('\n');
    });

    const results = extractPatterns(allContent);

    const hasResults = results.rpm || results.p2p || results.upn;

    if (hasResults) {
      return {
        success: true,
        url: targetUrl,
        results,
      };
    } else {
      return {
        success: false,
        url: targetUrl,
        results,
        message: 'No matching patterns found',
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      success: false,
      url: targetUrl,
      results: { rpm: null, p2p: null, upn: null },
      message: `Failed to inspect page: ${message}`,
    };
  } finally {
    await context.close();
  }
}
