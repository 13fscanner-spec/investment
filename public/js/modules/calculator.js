// Calculator module — Average price calculator with real-time comparison

import { showToast } from './dashboard.js';

const API_BASE = window.location.origin;
let transactionCount = 1;

export function initCalculator() {
  document.getElementById('btn-add-transaction').addEventListener('click', addTransactionRow);
  document.getElementById('btn-calculate').addEventListener('click', calculate);
}

function addTransactionRow() {
  const container = document.getElementById('calc-transactions');
  const idx = transactionCount++;
  const row = document.createElement('div');
  row.className = 'calc-transaction-row';
  row.dataset.index = idx;
  row.innerHTML = `
    <div class="form-group">
      <label>Precio</label>
      <input type="number" class="calc-price" placeholder="150.00" step="any" min="0.01">
    </div>
    <div class="form-group">
      <label>Cantidad</label>
      <input type="number" class="calc-qty" placeholder="100" step="any" min="0.01">
    </div>
    <div class="form-group">
      <label>Comisión</label>
      <input type="number" class="calc-comm" placeholder="0" step="any" min="0" value="0">
    </div>
    <button class="calc-remove" title="Eliminar">&times;</button>
  `;
  container.appendChild(row);

  row.querySelector('.calc-remove').addEventListener('click', () => {
    row.remove();
  });
}

async function calculate() {
  const ticker = document.getElementById('calc-ticker').value.trim().toUpperCase();
  const rows = document.querySelectorAll('.calc-transaction-row');

  let totalQty = 0;
  let totalCost = 0;
  let totalCommission = 0;
  const transactions = [];

  rows.forEach(row => {
    const price = parseFloat(row.querySelector('.calc-price')?.value);
    const qty = parseFloat(row.querySelector('.calc-qty')?.value);
    const comm = parseFloat(row.querySelector('.calc-comm')?.value) || 0;

    if (price > 0 && qty > 0) {
      totalQty += qty;
      totalCost += price * qty;
      totalCommission += comm;
      transactions.push({ price, qty, comm });
    }
  });

  if (!transactions.length) {
    showToast('Ingresá al menos una compra válida', 'error');
    return;
  }

  const avgPrice = totalCost / totalQty;
  const avgPriceWithComm = (totalCost + totalCommission) / totalQty;

  // Fetch current price if ticker provided
  let currentPrice = null;
  if (ticker) {
    try {
      const q = await fetch(`${API_BASE}/api/quote/${ticker}`).then(r => r.json());
      currentPrice = q.c || null;
    } catch { /* ignore */ }
  }

  const resultsCard = document.getElementById('calc-results-card');
  const results = document.getElementById('calc-results');
  resultsCard.style.display = 'block';

  let pnlHTML = '';
  if (currentPrice !== null) {
    const pnl = (currentPrice - avgPriceWithComm) * totalQty;
    const pnlPct = ((currentPrice - avgPriceWithComm) / avgPriceWithComm) * 100;
    const pnlClass = pnl >= 0 ? 'positive' : 'negative';
    const pnlSign = pnl >= 0 ? '+' : '';

    pnlHTML = `
      <div class="calc-result-item">
        <span class="calc-result-label">Precio Actual (${ticker})</span>
        <span class="calc-result-value">$${currentPrice.toFixed(2)}</span>
      </div>
      <div class="calc-result-item">
        <span class="calc-result-label">Ganancia/Pérdida Total</span>
        <span class="calc-result-value ${pnlClass}">${pnlSign}$${pnl.toFixed(2)}</span>
      </div>
      <div class="calc-result-item">
        <span class="calc-result-label">Rendimiento</span>
        <span class="calc-result-value ${pnlClass}">${pnlSign}${pnlPct.toFixed(2)}%</span>
      </div>
      <div class="calc-result-item">
        <span class="calc-result-label">Valor Actual de Posición</span>
        <span class="calc-result-value">$${(currentPrice * totalQty).toFixed(2)}</span>
      </div>
    `;
  }

  results.innerHTML = `
    <div class="calc-result-item">
      <span class="calc-result-label">Precio Promedio Ponderado</span>
      <span class="calc-result-value highlight">$${avgPrice.toFixed(4)}</span>
    </div>
    <div class="calc-result-item">
      <span class="calc-result-label">Precio Promedio (con comisiones)</span>
      <span class="calc-result-value">$${avgPriceWithComm.toFixed(4)}</span>
    </div>
    <div class="calc-result-item">
      <span class="calc-result-label">Cantidad Total</span>
      <span class="calc-result-value">${totalQty.toLocaleString('es-AR')}</span>
    </div>
    <div class="calc-result-item">
      <span class="calc-result-label">Inversión Total</span>
      <span class="calc-result-value">$${totalCost.toFixed(2)}</span>
    </div>
    <div class="calc-result-item">
      <span class="calc-result-label">Comisiones Totales</span>
      <span class="calc-result-value">$${totalCommission.toFixed(2)}</span>
    </div>
    <div class="calc-result-item">
      <span class="calc-result-label">Compras Realizadas</span>
      <span class="calc-result-value">${transactions.length}</span>
    </div>
    ${pnlHTML}
  `;

  showToast('Cálculo realizado', 'success');
}
