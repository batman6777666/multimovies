'use client';

import { useState } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

interface PatternResults {
  rpm: string | null;
  p2p: string | null;
  upn: string | null;
}

interface ApiResponse {
  success: boolean;
  url: string;
  results: PatternResults;
  message?: string;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PatternResults | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);

  const loadingSteps = [
    'Launching browser...',
    'Navigating to page...',
    'Waiting for content...',
    'Inspecting DOM elements...',
    'Searching for patterns...',
    'Extracting results...',
  ];

  const handleAnalyze = async () => {
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((prev) => Math.min(prev + 1, loadingSteps.length - 1));
    }, 3000);

    try {
      const response = await fetch(`${BACKEND_URL}/api/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data: ApiResponse = await response.json();

      if (data.success) {
        setResults(data.results);
      } else {
        setError(data.message || 'Failed to analyze page');
      }
    } catch {
      setError('Network error. Make sure the backend server is running.');
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
      setLoadingStep(loadingSteps.length - 1);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAnalyze();
    }
  };

  const foundCount = results
    ? [results.rpm, results.p2p, results.upn].filter(Boolean).length
    : 0;

  const renderResult = (label: string, value: string | null, field: string, badgeClass: string) => {
    const isFound = value !== null;
    return (
      <div className={`result-card ${isFound ? 'found' : 'not-found'}`}>
        <div className="result-header">
          <div className="result-label">
            <span className={`result-badge ${badgeClass}`}>{label}</span>
            <span className="result-type">{label} Stream Link</span>
          </div>
          <span className={`status-badge ${isFound ? 'found' : 'not-found'}`}>
            {isFound ? 'Found' : 'Not Found'}
          </span>
        </div>
        <div className="result-value">
          {isFound ? (
            <>
              <code>{value}</code>
              <button
                className={`copy-btn ${copiedField === field ? 'copied' : ''}`}
                onClick={() => handleCopy(value!, field)}
              >
                {copiedField === field ? 'Copied!' : 'Copy'}
              </button>
            </>
          ) : (
            <span className="empty">No matching pattern detected on this page</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="bg-glow" />
      <div className="container">
        <h1>Web Page Inspector</h1>
        <p className="subtitle">Extract RPM, P2P & UPN stream links from any webpage</p>

        <div className="input-wrapper">
          <div className="input-group">
            <input
              type="url"
              placeholder="https://example.com/movie/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button onClick={handleAnalyze} disabled={loading || !url.trim()}>
              {loading ? 'Analyzing...' : 'Inspect Page'}
            </button>
          </div>
        </div>

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <div className="loading-steps">
              {loadingSteps.map((step, i) => (
                <div key={i} className={`loading-step ${i <= loadingStep ? 'active' : ''}`}>
                  {i < loadingStep ? '\u2713' : i === loadingStep ? '\u25B6' : '\u25CB'} {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="error">
            <span className="error-icon">&#9888;</span>
            <span>{error}</span>
          </div>
        )}

        {results && (
          <>
            <div className="stats">
              <div className="stat-card">
                <div className="stat-number">{foundCount}</div>
                <div className="stat-label">Links Found</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">3</div>
                <div className="stat-label">Patterns Searched</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{results.rpm ? '1' : '0'}</div>
                <div className="stat-label">RPM Matches</div>
              </div>
            </div>
            <div className="results">
              {renderResult('RPM', results.rpm, 'rpm', 'rpm')}
              {renderResult('P2P', results.p2p, 'p2p', 'p2p')}
              {renderResult('UPN', results.upn, 'upn', 'upn')}
            </div>
          </>
        )}
      </div>
    </>
  );
}
