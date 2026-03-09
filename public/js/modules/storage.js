// Storage module — localStorage persistence for portfolio

const STORAGE_KEY = 'investai_portfolio';
const ANALYSIS_CACHE_KEY = 'investai_analysis_cache';
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3001' 
  ? 'http://localhost:3001' 
  : '';

export function getPortfolio() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function savePortfolio(holdings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  try {
    const res = await fetch(`${API_BASE}/api/portfolio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(holdings)
    });
  } catch (e) {
    console.error('Failed to sync portfolio with server:', e);
  }
}

export async function syncWithServer() {
  try {
    const res = await fetch(`${API_BASE}/api/portfolio`);
    if (res.ok) {
      const serverData = await res.json();
      if (Array.isArray(serverData)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serverData));
        return serverData;
      }
    }
  } catch (e) {
    console.error('Failed to fetch portfolio from server:', e);
  }
  return getPortfolio();
}

export function addHolding(holding) {
  const portfolio = getPortfolio();
  // Check if ticker already exists — merge if so
  const existing = portfolio.find(h => h.ticker === holding.ticker);
  if (existing) {
    // Compute new weighted average price
    const totalShares = existing.shares + holding.shares;
    const totalCost = (existing.shares * existing.avgPrice) + (holding.shares * holding.avgPrice);
    existing.avgPrice = totalCost / totalShares;
    existing.shares = totalShares;
    existing.commission = (existing.commission || 0) + (holding.commission || 0);
    // Keep earliest date
    if (holding.date < existing.date) existing.date = holding.date;
  } else {
    portfolio.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ticker: holding.ticker.toUpperCase(),
      shares: holding.shares,
      avgPrice: holding.avgPrice,
      commission: holding.commission || 0,
      date: holding.date || new Date().toISOString().slice(0, 10),
      transactions: holding.transactions || [{
        price: holding.avgPrice,
        qty: holding.shares,
        commission: holding.commission || 0,
        date: holding.date || new Date().toISOString().slice(0, 10)
      }]
    });
  }
  savePortfolio(portfolio);
  return portfolio;
}

export function updateHolding(id, updates) {
  const portfolio = getPortfolio();
  const idx = portfolio.findIndex(h => h.id === id);
  if (idx >= 0) {
    portfolio[idx] = { ...portfolio[idx], ...updates };
    savePortfolio(portfolio);
  }
  return portfolio;
}

export function removeHolding(id) {
  const portfolio = getPortfolio().filter(h => h.id !== id);
  savePortfolio(portfolio);
  return portfolio;
}

export function exportPortfolio() {
  return JSON.stringify(getPortfolio(), null, 2);
}

export function importPortfolio(jsonString) {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data)) throw new Error('El formato debe ser un array JSON');
  savePortfolio(data);
  return data;
}

// Transient analysis cache
export function getCachedAnalysis() {
  try {
    const data = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Expire after 15 min
    if (Date.now() - parsed._cachedAt > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedAnalysis(analysis) {
  localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify({
    ...analysis,
    _cachedAt: Date.now()
  }));
}
