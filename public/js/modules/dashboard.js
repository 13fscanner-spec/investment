// Dashboard module — AI analysis, recommendations, and news feed

import { getPortfolio, getCachedAnalysis, setCachedAnalysis } from './storage.js';

const API_BASE = 'http://localhost:3001';

// ── Fetch helpers ──
async function fetchJSON(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error de red');
  }
  return res.json();
}

// ── Init dashboard ──
export async function initDashboard() {
  setDashboardDate();
  loadIndices();
  loadNews();
  loadAnalysis();

  const aiProviderSelect = document.getElementById('ai-provider-select');
  const badgeAiProvider = document.getElementById('badge-ai-provider');

  aiProviderSelect.addEventListener('change', () => {
    // Determine target state
    const isGemini = aiProviderSelect.value === 'gemini';
    
    // Updates UI badge dynamically based on selection before load
    badgeAiProvider.textContent = isGemini ? 'Gemini AI' : 'OpenAI';
    badgeAiProvider.style.backgroundColor = isGemini ? 'rgba(74, 155, 235, 0.2)' : 'rgba(16, 163, 127, 0.2)';
    badgeAiProvider.style.color = isGemini ? '#4a9beb' : '#10a37f';
    badgeAiProvider.style.borderColor = isGemini ? 'rgba(74, 155, 235, 0.3)' : 'rgba(16, 163, 127, 0.3)';

    // Automatically trigger fresh analysis on change
    loadAnalysis();
  });

  document.getElementById('btn-refresh').addEventListener('click', forceRefresh);
  document.getElementById('btn-ai-refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('rotating');
    try {
      await loadAnalysis(true);
      showToast('Análisis IA actualizado', 'success');
    } catch (err) {
      showToast('Error en análisis: ' + err.message, 'error');
    } finally {
      btn.classList.remove('rotating');
    }
  });

  // Auto-refresh every 15 minutes
  setInterval(() => {
    loadIndices();
    loadNews();
    loadAnalysis();
  }, 15 * 60 * 1000);
}

function setDashboardDate() {
  const el = document.getElementById('dashboard-date');
  const now = new Date();
  el.textContent = now.toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Force Refresh ──
async function forceRefresh() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Actualizando...';

  try {
    await fetchJSON('/api/refresh', { method: 'POST' });
    localStorage.removeItem('investai_analysis_cache');
    await Promise.all([loadIndices(), loadNews(), loadAnalysis(true)]);
    showToast('Datos actualizados correctamente', 'success');
  } catch (err) {
    showToast('Error al actualizar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Actualizar';
  }
}

// ── Load Index Quotes ──
async function loadIndices() {
  const bar = document.getElementById('indices-bar');
  try {
    const indices = await fetchJSON('/api/indices');
    bar.innerHTML = indices.filter(i => !i.error && i.c).map(i => {
      const changeClass = i.dp >= 0 ? 'positive' : 'negative';
      const changeSign = i.dp >= 0 ? '+' : '';
      return `
        <div class="index-chip">
          <span class="index-symbol">${i.symbol}</span>
          <span class="index-price">$${i.c?.toFixed(2) || '—'}</span>
          <span class="index-change ${changeClass}">${changeSign}${i.dp?.toFixed(2) || '0.00'}%</span>
        </div>
      `;
    }).join('');

    // Update status
    const dot = document.querySelector('.status-dot');
    dot.classList.add('connected');
    document.querySelector('.status-text').textContent = 'Mercado conectado';
  } catch (err) {
    bar.innerHTML = '<div class="error-state"><p>Error al cargar índices</p></div>';
  }
}

// ── Load News ──
async function loadNews() {
  const container = document.getElementById('news-content');
  try {
    const news = await fetchJSON('/api/news');
    if (!news.length) {
      container.innerHTML = '<div class="no-data">No hay noticias disponibles</div>';
      return;
    }
    container.innerHTML = news.slice(0, 20).map(n => {
      const date = new Date(n.datetime * 1000);
      const timeAgo = getTimeAgo(date);
      return `
        <div class="news-item">
          ${n.image ? `<img class="news-thumb" src="${n.image}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="news-text">
            <div class="news-headline"><a href="${n.url}" target="_blank" rel="noopener">${n.headline}</a></div>
            <div class="news-meta">
              <span>${n.source}</span>
              <span>•</span>
              <span>${timeAgo}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="error-state"><p>Error al cargar noticias</p><p class="error-detail">${err.message}</p></div>`;
  }
}

// ── Load AI Analysis ──
async function loadAnalysis(force = false) {
  const analysisEl = document.getElementById('analysis-content');
  const buyEl = document.getElementById('buy-content');
  const sellEl = document.getElementById('sell-content');
  
  const aiProvider = document.getElementById('ai-provider-select').value;
  const riskProfile = document.getElementById('risk-profile-select').value;
  const badge = document.getElementById('badge-ai-provider');

  let loadingMsg = 'Generando análisis profundo con IA...';
  if (aiProvider === 'openai') {
    badge.textContent = 'OpenAI';
    badge.style.background = 'linear-gradient(135deg, rgba(16, 163, 127, 0.2), rgba(16, 163, 127, 0.1))';
    badge.style.color = '#10a37f';
    badge.style.borderColor = 'rgba(16, 163, 127, 0.3)';
  } else if (aiProvider === 'consensus') {
    badge.textContent = 'Consenso Maestro';
    badge.style.background = 'linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 140, 0, 0.1))';
    badge.style.color = '#ffd700';
    badge.style.borderColor = 'rgba(255, 215, 0, 0.5)';
    loadingMsg = 'Analizando con Múltiples IAs simultáneamente... (~20s)';
  } else {
    badge.textContent = 'Gemini AI';
    badge.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(96, 165, 250, 0.2))';
    badge.style.color = 'var(--accent-purple)';
    badge.style.borderColor = 'rgba(139, 92, 246, 0.3)';
  }

  // Check cache first

  if (!force) {
    const cached = getCachedAnalysis();
    if (cached?.analysis && (cached.provider === undefined || cached.provider === aiProvider) && (cached.riskProfile === undefined || cached.riskProfile === riskProfile)) {
      renderAnalysis(cached.analysis);
      updateLastUpdate(cached.timestamp);
      return;
    }
  }

  // Show loading
  analysisEl.innerHTML = loadingHTML(loadingMsg);
  buyEl.innerHTML = loadingHTML('Identificando oportunidades...');
  sellEl.innerHTML = loadingHTML('Evaluando portafolio...');

  try {
    const portfolio = getPortfolio().map(h => ({
      ticker: h.ticker,
      shares: h.shares,
      avgPrice: h.avgPrice
    }));

    const data = await fetchJSON('/api/market-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio, aiProvider, riskProfile })
    });

    if (data.analysis) {
      setCachedAnalysis({...data, provider: aiProvider, riskProfile});
      renderAnalysis(data.analysis);
      updateLastUpdate(data.timestamp);
    } else {
      throw new Error('No se recibió análisis');
    }
  } catch (err) {
    const errorHTML = `<div class="error-state"><p>Error al generar análisis</p><p class="error-detail">${err.message}</p><button class="btn btn-ghost btn-sm" onclick="location.reload()">Reintentar</button></div>`;
    analysisEl.innerHTML = errorHTML;
    buyEl.innerHTML = errorHTML;
    sellEl.innerHTML = errorHTML;
  }
}

// ── Render Analysis ──
function renderAnalysis(analysis) {
  renderExecutiveAndGlobal(analysis);
  renderBuyRecommendations(analysis.top5Comprar || []);
  renderSellRecommendations(analysis.recomendacionesVenta || []);
}

function renderExecutiveAndGlobal(a) {
  const el = document.getElementById('analysis-content');
  const toneClass = a.tonoMercado || 'neutral';
  const toneLabel = { bullish: '🟢 Alcista', bearish: '🔴 Bajista', neutral: '🟡 Neutral' }[toneClass] || '🟡 Neutral';

  const global = a.analisisGlobal || {};
  const arg = a.analisisArgentina || {};
  const alerts = a.alertas || [];

  el.innerHTML = `
    <div class="executive-summary">
      <p>${a.resumenEjecutivo || 'Análisis no disponible.'}</p>
      <div class="market-tone ${toneClass}">${toneLabel}</div>
    </div>

    ${alerts.length ? `
      <div class="analysis-section">
        <h3>⚠️ Alertas del Día</h3>
        ${alerts.map(al => `<div class="alert-item"><span class="alert-icon">⚡</span><span>${al}</span></div>`).join('')}
      </div>
    ` : ''}

    <div class="analysis-tabs">
      <button class="analysis-tab active" data-tab="global">🌎 Global</button>
      <button class="analysis-tab" data-tab="argentina">🇦🇷 Argentina</button>
    </div>

    <div class="analysis-tab-content active" data-tab-content="global">
      ${renderGlobalSection('Estados Unidos', '🇺🇸', global.eeuu)}
      ${renderGlobalSection('Europa', '🇪🇺', global.europa)}
      ${renderGlobalSection('Asia', '🌏', global.asia)}
      ${renderGlobalSection('Geopolítica', '🌐', global.geopolitica)}
      ${renderGlobalSection('Datos Macro', '📊', global.datosMacro)}
    </div>

    <div class="analysis-tab-content" data-tab-content="argentina">
      ${renderGlobalSection('Economía', '💰', arg.economia)}
      ${renderGlobalSection('Mercado BYMA/MERVAL', '📈', arg.mercado)}
      ${renderGlobalSection('Tipo de Cambio', '💱', arg.tipoCambio)}
      ${renderGlobalSection('Perspectivas', '🔮', arg.perspectivas)}
    </div>
  `;

  // Tab click handlers
  el.querySelectorAll('.analysis-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      el.querySelectorAll('.analysis-tab').forEach(t => t.classList.remove('active'));
      el.querySelectorAll('.analysis-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      el.querySelector(`[data-tab-content="${tab.dataset.tab}"]`).classList.add('active');
    });
  });
}

function renderGlobalSection(title, emoji, text) {
  if (!text) return '';
  return `
    <div class="analysis-section">
      <h3>${emoji} ${title}</h3>
      <p class="analysis-text">${text}</p>
    </div>
  `;
}

function renderBuyRecommendations(recs) {
  const el = document.getElementById('buy-content');
  if (!recs.length) {
    el.innerHTML = '<div class="no-data">No hay recomendaciones de compra hoy</div>';
    return;
  }

  el.innerHTML = recs.map((r, i) => {
    const confLevel = r.confianza >= 7 ? 'high' : r.confianza >= 4 ? 'medium' : 'low';
    return `
      <div class="rec-card">
        <div class="rec-header">
          <div>
            <span class="rec-ticker">#${i + 1} ${r.ticker}</span>
            <span class="rec-nombre">${r.nombre || ''}</span>
          </div>
          <span class="rec-tipo ${r.tipo || 'cedear'}">${r.tipo === 'accion_arg' ? 'Acción ARG' : 'CEDEAR'}</span>
        </div>
        
        <div class="rec-confidence">
          <div class="confidence-bar">
            <div class="confidence-fill ${confLevel}" style="width: ${(r.confianza || 5) * 10}%"></div>
          </div>
          <span class="confidence-label">${r.confianza || '?'}/10</span>
        </div>

        ${r.precioReferencia ? `<div class="rec-detail"><span class="rec-detail-label">Precio Ref.</span><span class="rec-detail-text">${r.precioReferencia}</span></div>` : ''}
        <div class="rec-detail"><span class="rec-detail-label">Motivo</span><p class="rec-detail-text">${r.motivo || ''}</p></div>
        <div class="rec-detail"><span class="rec-detail-label">Riesgos</span><p class="rec-detail-text">${r.riesgos || ''}</p></div>
        <div class="rec-detail"><span class="rec-detail-label">Variables</span><p class="rec-detail-text">${r.variables || ''}</p></div>

        <div class="rec-meta">
          <div class="rec-meta-item">📅 <strong>${r.horizonte || 'N/A'}</strong></div>
          <div class="rec-meta-item">🎯 Confianza: <strong>${r.confianza || '?'}/10</strong></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderSellRecommendations(recs) {
  const el = document.getElementById('sell-content');
  if (!recs.length) {
    el.innerHTML = '<div class="no-data">No hay recomendaciones de venta. Tu portafolio luce bien 👍</div>';
    return;
  }

  el.innerHTML = recs.map(r => `
    <div class="sell-card">
      <div class="sell-header">
        <span class="sell-ticker">${r.ticker}</span>
        <span class="urgency-badge ${r.urgencia || 'media'}">${r.urgencia || 'media'}</span>
      </div>
      <p class="sell-reason">${r.motivo || ''}</p>
    </div>
  `).join('');
}

// ── Helpers ──
function updateLastUpdate(timestamp) {
  const el = document.getElementById('last-update');
  if (timestamp) {
    const d = new Date(timestamp);
    el.textContent = `Última actualización: ${d.toLocaleTimeString('es-AR')}`;
  }
}

function loadingHTML(text) {
  return `<div class="loading-state"><div class="spinner"></div><p>${text}</p><p class="loading-hint">Esto puede tomar 15-30 segundos</p></div>`;
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Ahora';
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)}h`;
  return `Hace ${Math.floor(seconds / 86400)}d`;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export { showToast };
