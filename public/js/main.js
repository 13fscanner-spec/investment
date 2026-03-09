// Main entry point — Panel routing and initialization

import { initDashboard } from './modules/dashboard.js';
import { initPortfolio, renderPortfolio } from './modules/portfolio.js';
import { initCalculator } from './modules/calculator.js';

// ── Panel Navigation ──
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.panel;

      // Update nav active state
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Show target panel
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${target}`).classList.add('active');

      // Refresh portfolio data when switching to it
      if (target === 'portfolio') {
        renderPortfolio();
      }
    });
  });
}

// ── Disclaimer ──
function initDisclaimer() {
  const disclaimer = document.getElementById('disclaimer');
  const dismissed = localStorage.getItem('investai_disclaimer_dismissed');
  if (dismissed) {
    disclaimer.classList.add('hidden');
  }

  document.getElementById('btn-dismiss-disclaimer').addEventListener('click', () => {
    disclaimer.classList.add('hidden');
    localStorage.setItem('investai_disclaimer_dismissed', 'true');
  });
}

// ── Initialize App ──
async function init() {
  initNavigation();
  initDisclaimer();
  initDashboard();
  initPortfolio();
  initCalculator();
}

document.addEventListener('DOMContentLoaded', init);
