// Portfolio module — CRUD, donut chart, real-time prices

import { getPortfolio, savePortfolio, addHolding, removeHolding, exportPortfolio, importPortfolio, syncWithServer } from './storage.js';
import { showToast } from './dashboard.js';

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3001' 
  ? 'http://localhost:3001' 
  : '';
let searchTimeout = null;
let currentSort = { column: 'ticker', order: 'asc' };

export async function initPortfolio() {
  await syncWithServer();
  renderPortfolio();
  bindEvents();
  
  // Real-time price updates (every 10 seconds, only during market hours)
  setInterval(() => {
    if (isMarketOpen() && document.getElementById('panel-portfolio').classList.contains('active')) {
      renderPortfolio();
    }
  }, 10000);
}

// Check if BYMA market is open (Mon-Fri, 11:00-17:05 ART)
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay(); // 0 is Sunday, 6 is Saturday
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (day === 0 || day === 6) return false;
  
  const timeNum = hour * 100 + minute;
  return timeNum >= 1100 && timeNum <= 1705;
}

// ── Event Bindings ──
function bindEvents() {
  // Add holding modal
  document.getElementById('btn-add-holding').addEventListener('click', () => openModal());
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-add').addEventListener('click', closeModal);
  document.getElementById('form-add-holding').addEventListener('submit', handleAddHolding);

  // Table sorting
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (currentSort.column === col) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.column = col;
        currentSort.order = 'desc'; // Default to desc to see highest values first
      }
      renderPortfolio();
    });
  });

  // Ticker search
  document.getElementById('input-ticker').addEventListener('input', handleTickerSearch);

  // Refresh Portfolio
  const btnRefresh = document.getElementById('btn-refresh-portfolio');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.disabled = true;
      const span = btnRefresh.querySelector('span');
      if (span) span.textContent = 'Actualizando...';
      try {
        await renderPortfolio();
        showToast('Precios actualizados', 'success');
      } catch (err) {
        showToast('Error al actualizar precios', 'error');
      } finally {
        btnRefresh.disabled = false;
        if (span) span.textContent = 'Actualizar';
      }
    });
  }

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('modal-import').classList.add('active');
  });
  document.getElementById('modal-import-close').addEventListener('click', () => {
    document.getElementById('modal-import').classList.remove('active');
  });
  document.getElementById('btn-cancel-import').addEventListener('click', () => {
    document.getElementById('modal-import').classList.remove('active');
  });
  document.getElementById('btn-confirm-import').addEventListener('click', handleImport);

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });
}

// ── Render Portfolio ──
export async function renderPortfolio() {
  const portfolio = getPortfolio();
  if (!portfolio.length) {
    renderEmptyState();
    renderSummary([], {});
    renderChart([]);
    return;
  }

  // Fetch all CEDEAR quotes in ARS from our new endpoint (mirrors data912)
  let cedearQuotes = [];
  try {
    cedearQuotes = await fetch(`${API_BASE}/api/cedears`).then(r => r.json());
  } catch (e) {
    console.debug("Error fetching direct BYMA quotes", e);
  }

  // Map to hold our final price data
  const prices = {};
  
  // Process portfolio using direct ARS prices
  portfolio.forEach(h => {
    const symbol = h.ticker.toUpperCase();
    const quote = cedearQuotes.find(q => q.symbol === symbol);
    
    if (quote) {
      prices[symbol] = {
        ars: quote.c || 0,
        pctChange: quote.pct_change || 0,
        direct: true
      };
    } else {
      prices[symbol] = { ars: 0, pctChange: 0, direct: false };
    }
  });
  renderTable(portfolio, prices);
  renderSummary(portfolio, prices);
  renderChart(portfolio);
}

function renderEmptyState() {
  document.getElementById('holdings-body').innerHTML =
    '<tr><td colspan="10" class="empty-state">No hay activos cargados. Agregá tu primer activo con el botón + de arriba.</td></tr>';
}

function renderTable(portfolio, prices) {
  const tbody = document.getElementById('holdings-body');
  if (portfolio.length === 0) {
    renderEmptyState();
    return;
  }

  // Pre-calculate values for sorting
  const enrichedPortfolio = portfolio.map(h => {
    const priceData = prices[h.ticker.toUpperCase()] || { ars: 0, pctChange: 0, direct: false };
    const currentPrice = priceData.ars;
    const value = currentPrice * h.shares;
    const cost = h.avgPrice * h.shares;
    const pnl = value - cost;
    const pnlPct = cost > 0 ? ((pnl / cost) * 100) : 0;
    
    return {
      ...h,
      currentPrice,
      pctChange: priceData.pctChange || 0,
      value,
      cost,
      pnl,
      pnlPct
    };
  });

  // Apply sorting
  enrichedPortfolio.sort((a, b) => {
    let valA = a[currentSort.column];
    let valB = b[currentSort.column];
    
    if (currentSort.column === 'ticker') {
      return currentSort.order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    
    return currentSort.order === 'asc' ? valA - valB : valB - valA;
  });

  // Update header UI
  document.querySelectorAll('th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.sort === currentSort.column) {
      icon.innerHTML = currentSort.order === 'asc' ? '&#9650;' : '&#9660;'; // Up/Down triangles
    } else {
      icon.innerHTML = '';
    }
  });

  tbody.innerHTML = enrichedPortfolio.map(h => {
    const pnlClass = h.pnl >= 0 ? 'positive' : 'negative';
    const pnlSign = h.pnl >= 0 ? '+' : '';

    let suggestionBadge = '<span class="suggestion-badge neutral">-</span>';
    if (h.pnlPct >= 25) {
      suggestionBadge = '<span class="suggestion-badge take-profit">Tomar Ganancias</span>';
    } else if (h.pnlPct <= -15) {
      suggestionBadge = '<span class="suggestion-badge stop-loss">Stop-Loss / Revisar</span>';
    }

    return `
      <tr>
        <td class="ticker-cell">${h.ticker}</td>
        <td>${h.shares.toLocaleString('es-AR')}</td>
        <td>$${h.avgPrice.toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
        <td class="${h.pctChange >= 0 ? 'positive' : 'negative'}">${h.pctChange >= 0 ? '+' : ''}${h.pctChange.toFixed(2)}%</td>
        <td class="price-cell">
          $${h.currentPrice.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
        </td>
        <td>$${h.value.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="${pnlClass}">${pnlSign}$${h.pnl.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="${pnlClass}">${pnlSign}${h.pnlPct.toFixed(2)}%</td>
        <td>${suggestionBadge}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-icon delete" title="Eliminar" data-id="${h.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Delete handlers
  tbody.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('¿Estás seguro de eliminar este activo?')) {
        removeHolding(btn.dataset.id);
        renderPortfolio();
        showToast('Activo eliminado', 'success');
      }
    });
  });
}

function renderSummary(portfolio, prices) {
  let totalValue = 0, totalCost = 0, totalPrevValue = 0;
  
  portfolio.forEach(h => {
    const priceData = prices[h.ticker.toUpperCase()] || { ars: 0, pctChange: 0 };
    const currentPrice = priceData.ars;
    const pctChange = priceData.pctChange || 0;
    
    totalValue += currentPrice * h.shares;
    totalCost += h.avgPrice * h.shares;
    
    // Calcular el valor del día anterior para el rendimiento diario
    const prevPrice = currentPrice / (1 + (pctChange / 100));
    totalPrevValue += prevPrice * h.shares;
  });
  
  const totalPnl = totalValue - totalCost;
  const totalReturn = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;
  
  const dailyPnl = totalValue - totalPrevValue;
  const dailyReturn = totalPrevValue > 0 ? ((dailyPnl / totalPrevValue) * 100) : 0;

  document.getElementById('total-value').textContent = `$${totalValue.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById('total-cost').textContent = `$${totalCost.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  const pnlEl = document.getElementById('total-pnl');
  pnlEl.textContent = `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  pnlEl.className = `summary-value ${totalPnl >= 0 ? 'positive' : 'negative'}`;

  const retEl = document.getElementById('total-return');
  retEl.textContent = `${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`;
  retEl.className = `summary-value ${totalReturn >= 0 ? 'positive' : 'negative'}`;

  const dailyRetEl = document.getElementById('daily-return');
  if (dailyRetEl) {
    dailyRetEl.textContent = `${dailyReturn >= 0 ? '+' : ''}${dailyReturn.toFixed(2)}% ($${Math.abs(dailyPnl).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})})`;
    dailyRetEl.className = `summary-value ${dailyReturn >= 0 ? 'positive' : 'negative'}`;
  }
}

// ── Donut Chart ──
const CHART_COLORS = [
  '#a78bfa', '#60a5fa', '#22d3ee', '#34d399', '#fbbf24',
  '#fb923c', '#f87171', '#e879f9', '#38bdf8', '#4ade80'
];

function renderChart(portfolio) {
  const canvas = document.getElementById('allocation-chart');
  const legend = document.getElementById('chart-legend');
  const ctx = canvas.getContext('2d');

  // High DPI
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 300 * dpr;
  canvas.height = 300 * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, 300, 300);

  if (!portfolio.length) {
    ctx.fillStyle = '#3e3e56';
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Sin activos', 150, 155);
    legend.innerHTML = '';
    return;
  }

  const total = portfolio.reduce((s, h) => s + (h.avgPrice * h.shares), 0);
  const cx = 150, cy = 150, outerR = 120, innerR = 75;
  let startAngle = -Math.PI / 2;

  legend.innerHTML = '';

  portfolio.forEach((h, i) => {
    const value = h.avgPrice * h.shares;
    const pct = total > 0 ? value / total : 0;
    const sweepAngle = pct * 2 * Math.PI;
    const color = CHART_COLORS[i % CHART_COLORS.length];

    // Draw arc
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle, startAngle + sweepAngle);
    ctx.arc(cx, cy, innerR, startAngle + sweepAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    startAngle += sweepAngle;

    // Legend item
    legend.innerHTML += `
      <div class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span>${h.ticker} ${(pct * 100).toFixed(1)}%</span>
      </div>
    `;
  });

  // Center text
  ctx.fillStyle = '#f1f1f4';
  ctx.font = '700 16px Inter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`$${total.toFixed(0)}`, cx, cy - 8);
  ctx.font = '400 11px Inter';
  ctx.fillStyle = '#9b9bb0';
  ctx.fillText('Inversión Total', cx, cy + 12);
}

// ── Modal Handling ──
function openModal() {
  document.getElementById('modal-add-holding').classList.add('active');
  document.getElementById('form-add-holding').reset();
  document.getElementById('input-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('ticker-search-results').classList.remove('active');
  document.getElementById('modal-title').textContent = 'Agregar Activo';
}

function closeModal() {
  document.getElementById('modal-add-holding').classList.remove('active');
}

function handleAddHolding(e) {
  e.preventDefault();
  const ticker = document.getElementById('input-ticker').value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById('input-shares').value);
  const price = parseFloat(document.getElementById('input-price').value);
  const date = document.getElementById('input-date').value;
  const commission = parseFloat(document.getElementById('input-commission').value) || 0;

  if (!ticker || !shares || !price) {
    showToast('Completá todos los campos obligatorios', 'error');
    return;
  }

  addHolding({
    ticker,
    shares,
    avgPrice: price,
    commission,
    date
  });

  closeModal();
  renderPortfolio();
  showToast(`${ticker} agregado al portafolio`, 'success');
}

// ── Ticker Search ──
function handleTickerSearch(e) {
  const query = e.target.value.trim();
  const dropdown = document.getElementById('ticker-search-results');

  if (query.length < 2) {
    dropdown.classList.remove('active');
    return;
  }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const data = await fetch(`${API_BASE}/api/search/${encodeURIComponent(query)}`).then(r => r.json());
      if (data.result?.length) {
        dropdown.innerHTML = data.result.slice(0, 8).map(r => `
          <div class="search-result-item" data-symbol="${r.symbol}">
            <span class="symbol">${r.symbol}</span>
            <span class="description">${r.description}</span>
          </div>
        `).join('');
        dropdown.classList.add('active');

        dropdown.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            document.getElementById('input-ticker').value = item.dataset.symbol;
            dropdown.classList.remove('active');
          });
        });
      } else {
        dropdown.classList.remove('active');
      }
    } catch {
      dropdown.classList.remove('active');
    }
  }, 300);
}

// ── Export / Import ──
function handleExport() {
  const data = exportPortfolio();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portafolio_investai_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Portafolio exportado correctamente', 'success');
}

function handleImport() {
  const textarea = document.getElementById('import-textarea');
  try {
    importPortfolio(textarea.value);
    document.getElementById('modal-import').classList.remove('active');
    renderPortfolio();
    showToast('Portafolio importado correctamente', 'success');
  } catch (err) {
    showToast('Error al importar: ' + err.message, 'error');
  }
}
