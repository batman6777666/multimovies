const BACKEND_URL = window.BACKEND_URL || 'http://localhost:4000';

const loadingSteps = [
  'Launching browser...',
  'Navigating to page...',
  'Waiting for content...',
  'Inspecting DOM elements...',
  'Searching for patterns...',
  'Extracting results...',
];

let loading = false;
let loadingStep = 0;
let stepInterval = null;
let copiedField = null;

const urlInput = document.getElementById('url-input');
const analyzeBtn = document.getElementById('analyze-btn');
const loadingEl = document.getElementById('loading');
const loadingStepsEl = document.getElementById('loading-steps');
const errorEl = document.getElementById('error');
const errorText = document.getElementById('error-text');
const resultsContainer = document.getElementById('results-container');
const resultsEl = document.getElementById('results');
const foundCountEl = document.getElementById('found-count');
const rpmCountEl = document.getElementById('rpm-count');

function renderLoadingSteps() {
  loadingStepsEl.innerHTML = loadingSteps.map((step, i) => {
    const icon = i < loadingStep ? '\u2713' : i === loadingStep ? '\u25B6' : '\u25CB';
    const activeClass = i <= loadingStep ? 'active' : '';
    return `<div class="loading-step ${activeClass}">${icon} ${step}</div>`;
  }).join('');
}

function renderResult(label, value, field, badgeClass) {
  const isFound = value !== null;
  return `
    <div class="result-card ${isFound ? 'found' : 'not-found'}">
      <div class="result-header">
        <div class="result-label">
          <span class="result-badge ${badgeClass}">${label}</span>
          <span class="result-type">${label} Stream Link</span>
        </div>
        <span class="status-badge ${isFound ? 'found' : 'not-found'}">
          ${isFound ? 'Found' : 'Not Found'}
        </span>
      </div>
      <div class="result-value">
        ${isFound ? `
          <code>${value}</code>
          <button class="copy-btn ${copiedField === field ? 'copied' : ''}" onclick="handleCopy('${value}', '${field}')">
            ${copiedField === field ? 'Copied!' : 'Copy'}
          </button>
        ` : '<span class="empty">No matching pattern detected on this page</span>'}
      </div>
    </div>
  `;
}

async function handleCopy(text, field) {
  await navigator.clipboard.writeText(text);
  copiedField = field;
  updateResults();
  setTimeout(() => {
    copiedField = null;
    updateResults();
  }, 2000);
}

function updateResults() {
  if (!resultsEl.dataset.results) return;
  const results = JSON.parse(resultsEl.dataset.results);
  resultsEl.innerHTML =
    renderResult('RPM', results.rpm, 'rpm', 'rpm') +
    renderResult('P2P', results.p2p, 'p2p', 'p2p') +
    renderResult('UPN', results.upn, 'upn', 'upn');
}

async function handleAnalyze() {
  const url = urlInput.value.trim();
  if (!url || loading) return;

  loading = true;
  loadingStep = 0;
  errorEl.style.display = 'none';
  resultsContainer.style.display = 'none';
  loadingEl.style.display = 'block';
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';
  urlInput.disabled = true;
  renderLoadingSteps();

  stepInterval = setInterval(() => {
    loadingStep = Math.min(loadingStep + 1, loadingSteps.length - 1);
    renderLoadingSteps();
  }, 3000);

  try {
    const response = await fetch(`${BACKEND_URL}/api/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (data.success) {
      const foundCount = [data.results.rpm, data.results.p2p, data.results.upn].filter(Boolean).length;
      foundCountEl.textContent = foundCount;
      rpmCountEl.textContent = data.results.rpm ? '1' : '0';
      resultsEl.dataset.results = JSON.stringify(data.results);
      updateResults();
      resultsContainer.style.display = 'block';
    } else {
      errorText.textContent = data.message || 'Failed to analyze page';
      errorEl.style.display = 'flex';
    }
  } catch {
    errorText.textContent = 'Network error. Make sure the backend server is running.';
    errorEl.style.display = 'flex';
  } finally {
    clearInterval(stepInterval);
    loading = false;
    loadingStep = loadingSteps.length - 1;
    renderLoadingSteps();
    loadingEl.style.display = 'none';
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Inspect Page';
    urlInput.disabled = false;
  }
}

analyzeBtn.addEventListener('click', handleAnalyze);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAnalyze();
});
urlInput.addEventListener('input', () => {
  analyzeBtn.disabled = !urlInput.value.trim();
});

// Enable input when ready
urlInput.disabled = false;
analyzeBtn.disabled = true;
