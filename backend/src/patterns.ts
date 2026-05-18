export interface PatternResult {
  rpm: string | null;
  p2p: string | null;
  upn: string | null;
}

export const PATTERNS = {
  rpm: /https?:\/\/multimovies\.rpmhub\.site\/#[A-Za-z0-9_-]+/g,
  p2p: /https?:\/\/multimovies\.p2pplay\.pro\/#[A-Za-z0-9_-]+/g,
  upn: /https?:\/\/server1\.uns\.bio\/#[A-Za-z0-9_-]+/g,
};

export function extractPatterns(content: string): PatternResult {
  const result: PatternResult = { rpm: null, p2p: null, upn: null };

  for (const [key, regex] of Object.entries(PATTERNS)) {
    const matches = content.match(regex);
    if (matches && matches.length > 0) {
      result[key as keyof PatternResult] = matches[0];
    }
  }

  return result;
}
