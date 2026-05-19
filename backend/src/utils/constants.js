module.exports = {
  BASE_URLS: {
    MOVIE: 'https://multimovies.fyi/movies',
    SERIES: 'https://multimovies.fyi/episodes',
  },

  // Regex to find each server URL + capture the video ID in group 1
  STREAM_PATTERNS: {
    rpm: /https?:\/\/multimovies\.rpmhub\.site\/[#]?([a-zA-Z0-9_-]+)/,
    p2p: /https?:\/\/multimovies\.p2pplay\.pro\/[#]?([a-zA-Z0-9_-]+)/,
    upn: /https?:\/\/server1\.uns\.bio\/[#]?([a-zA-Z0-9_-]+)/,
    rpmFallback: /rpmhub\.site\/(?:embed\/|#|\?id=)([a-zA-Z0-9_-]+)/,
    p2pFallback: /p2pplay\.pro\/(?:embed\/|#|\?id=)([a-zA-Z0-9_-]+)/,
    upnFallback: /uns\.bio\/(?:embed\/|#|\?id=)([a-zA-Z0-9_-]+)/,
    evidenFallback: /evid\/([a-zA-Z0-9_-]+)/,
  },

  // Build final URLs from a single video ID
  LINK_TEMPLATES: {
    rpm: (id) => `https://multimovies.rpmhub.site/#${id}`,
    p2p: (id) => `https://multimovies.p2pplay.pro/#${id}`,
    upn: (id) => `https://server1.uns.bio/#${id}`,
  },

  // Puppeteer resource blocking
  BLOCKED_RESOURCE_TYPES: new Set(['image', 'font', 'stylesheet', 'media']),
  BLOCKED_URL_PATTERNS: [
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'googlesyndication.com',
    'facebook.com/tr',
    'hotjar.com',
    'clarity.ms',
  ],

  // Data attributes to scan for embed links
  EMBED_ATTRIBUTES: [
    'data-link',
    'data-src',
    'data-source',
    'data-stream',
    'data-video',
    'data-embed',
    'data-player',
    'data-url',
  ],

  ERROR_CODES: {
    MISSING_NAME: 'MISSING_NAME',
    INVALID_TYPE: 'INVALID_TYPE',
    MISSING_SEASON_EPISODE: 'MISSING_SEASON_EPISODE',
    INVALID_API_KEY: 'INVALID_API_KEY',
    SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
    LINKS_NOT_FOUND: 'LINKS_NOT_FOUND',
    RATE_LIMITED: 'RATE_LIMITED',
    TIMEOUT: 'TIMEOUT',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
};
