/**
 * Normalizes a movie/series name into a URL-safe slug.
 *
 * Rules applied in order:
 *  1. Strip year suffixes like (2024) or [2024]
 *  2. Strip quality tags like [HD], [4K]
 *  3. Lowercase
 *  4. Remove all chars except a-z, 0-9, spaces, hyphens
 *  5. Collapse spaces/hyphens → single hyphen
 *  6. Trim leading/trailing hyphens
 */
function normalizeName(name) {
  return name
    .replace(/[\(\[]\s*\d{4}\s*[\)\]]/g, '') // (2024) or [2024]
    .replace(/[\(\[]\s*(hd|4k|bluray|dvdrip|webrip|web-dl)\s*[\)\]]/gi, '') // quality tags
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // strip special chars
    .trim()
    .replace(/[\s]+/g, '-') // spaces → single hyphen
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // trim edges
}

/**
 * Builds the target source URL from normalized name + content type.
 *
 * Movie:  https://multimovies.fyi/movies/{slug}/
 * Series: https://multimovies.fyi/episodes/{slug}-{S}x{E}/
 */
function buildUrl(type, normalizedName, season, episode) {
  if (type === 'movie') {
    return `https://multimovies.fyi/movies/${normalizedName}/`;
  }
  const ep = typeof episode === 'number' ? episode : parseInt(episode, 10) || 1;
  const sn = typeof season === 'number' ? season : parseInt(season, 10) || 1;
  return `https://multimovies.fyi/episodes/${normalizedName}-${sn}x${ep}/`;
}

module.exports = { normalizeName, buildUrl };
