import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env manually (avoid extra dependency issues)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Inicializar clientes IA
const genAI = new GoogleGenerativeAI(GEMINI_KEY || 'dummy_key');
const openaiClient = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;
const anthropicClient = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ---------- FINNHUB HELPERS ----------
async function finnhub(endpoint) {
  const url = `https://finnhub.io/api/v1${endpoint}&token=${FINNHUB_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
  return res.json();
}

async function getMarketNews() {
  return finnhub('/news?category=general');
}

async function getQuote(symbol) {
  return finnhub(`/quote?symbol=${symbol}`);
}

async function getCompanyNews(symbol) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  return finnhub(`/company-news?symbol=${symbol}&from=${from}&to=${to}`);
}

async function getBasicFinancials(symbol) {
  return finnhub(`/stock/metric?symbol=${symbol}&metric=all`);
}

async function searchSymbol(query) {
  return finnhub(`/search?q=${encodeURIComponent(query)}`);
}

async function getIndexQuotes() {
  const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'EEM', 'VWO', 'GLD', 'TLT', 'GGAL', 'YPF']; // GGAL/YPF as proxies for Merval/local sentiment
  const promises = symbols.map(async s => {
    try {
      const q = await getQuote(s);
      return { symbol: s, ...q };
    } catch { return { symbol: s, error: true }; }
  });
  return Promise.all(promises);
}

// ---------- END FINNHUB HELPERS ----------

// Cache for analysis (avoid spamming API)
let analysisCache = { data: null, timestamp: 0 };
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function buildAnalysisPrompt(news, indices, portfolio, portfolioEnriched, riskProfile) {
  const newsText = news.slice(0, 25).map((n, i) =>
    `${i + 1}. [${n.source}] ${n.headline} (${new Date(n.datetime * 1000).toLocaleDateString()})`
  ).join('\n');

  const indicesText = indices.filter(i => !i.error).map(i =>
    `${i.symbol}: Precio actual $${i.c}, Cambio ${i.dp > 0 ? '+' : ''}${i.dp?.toFixed(2)}%, Apertura $${i.o}, Máximo $${i.h}, Mínimo $${i.l}`
  ).join('\n');

  let portfolioText = 'El usuario no tiene activos cargados aún.';
  if (portfolio && portfolio.length > 0) {
    if (portfolioEnriched && portfolioEnriched.length > 0) {
      portfolioText = portfolioEnriched.map(p => {
        const item = portfolio.find(h => h.ticker === p.ticker);
        const metric = p.metric || {};
        let str = `- ${p.ticker}: ${item.shares} acciones, precio promedio $${item.avgPrice}.`;
        if (metric.peBasicExclExtraTTM) str += ` P/E (TTM): ${metric.peBasicExclExtraTTM.toFixed(2)}.`;
        if (metric.epsBasicExclExtraItemsTTM) str += ` EPS: ${metric.epsBasicExclExtraItemsTTM.toFixed(2)}.`;
        if (metric['52WeekHigh']) str += ` Max 52-wk: $${metric['52WeekHigh']}.`;
        if (metric['52WeekLow']) str += ` Min 52-wk: $${metric['52WeekLow']}.`;
        
        if (p.news && p.news.length > 0) {
          str += `\n  Noticias recientes de ${p.ticker}: ` + p.news.map(n => `[${n.headline}]`).join(' | ');
        }
        return str;
      }).join('\n');
    } else {
      portfolioText = portfolio.map(h => `- ${h.ticker}: ${h.shares} acciones, precio promedio $${h.avgPrice}`).join('\n');
    }
  }

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return `Actuás como un Gestor de Portafolio Institucional Cuantitativo Senior ("Portfolio Manager") operando en BYMA (Argentina) y Wall Street (CEDEARs).
Fecha de hoy: ${today}

PERFIL DE RIESGO DEL USUARIO: ${riskProfile.toUpperCase()}
[ATENCIÓN: Basa todas tus recomendaciones primordiales y el tono del mercado estrictamente bajo las directrices del perfil ${riskProfile}. Si es Conservador, evita comprar empresas volátiles de alto P/E y prioriza dividendos o rotación defensiva. Si es Agresivo, busca oportunidades de Growth o small caps.]

DATOS DE MERCADO EN TIEMPO REAL:
Índices principales y proxies:
${indicesText}

Feed de Noticias Recientes (Globales):
${newsText}

Portafolio actual del usuario (con Fundamentales y Noticias Específicas integradas):
${portfolioText}

### INSTRUCCIONES:
Tomando en cuenta mi cartera actual y posiciones detalladas arriba, realiza un análisis exhaustivo del mercado y la situación actual, tanto a nivel nacional (enfocándote en Argentina, incluyendo factores locales como inflación, políticas económicas y eventos regionales) como mundial (considerando noticias relevantes, eventos geopolíticos como conflictos internacionales o tensiones comerciales, datos económicos recientes como PIB, desempleo, tasas de interés e inflación global, y tendencias de los mercados financieros como volatilidad en índices como S&P 500, NASDAQ o Merval).

En base a este análisis, recomienda un top 5 de tickers (acciones, ETFs u otros activos financieros) adecuados para adquirir en el día de hoy, priorizando aquellos que no solo ofrezcan oportunidades a corto plazo, sino que contribuyan al crecimiento general de mi cartera a mediano y largo plazo, alineados con los acontecimientos actuales. Para cada recomendación, explica:
- Los motivos de la elección (e.g., fundamentos de la empresa, tendencias sectoriales, catalizadores específicos).
- Los riesgos asociados (e.g., volatilidad, exposición a eventos geopolíticos, riesgos macroeconómicos).
- Las variables que justifican la elección (e.g., métricas como P/E ratio, crecimiento de ingresos, análisis técnico como soportes/resistencias, o datos de volumen).

Además, evalúa si se debe vender o ajustar alguna posición existente en mi cartera, explicando los motivos, riesgos de mantenerla y variables que sugieren la venta (e.g., sobrevaloración, deterioro en fundamentos, o exposición a riesgos inminentes). Considera la diversificación de la cartera, mi tolerancia al riesgo (moderada), y objetivos de crecimiento sostenible.

## FORMATO DE RESPUESTA EN JSON ESTRICTO
Respondé ÚNICAMENTE con JSON válido:
{
  "fecha": "${today}",
  "resumenEjecutivo": "La postura que debe tomar el portafolio HOY mirando los próximos meses.",
  "analisisGlobal": {
    "eeuu": "Impacto estructural en flujos y tasas.",
    "europa": "Breve postura BCE.",
    "asia": "Tendencia asiática/commodities.",
    "geopolitica": "Riesgo macro sostenido.",
    "datosMacro": "El dato que confirma/niega el ciclo."
  },
  "analisisArgentina": {
    "economia": "Datos duros que afectan la proyección país.",
    "mercado": "Rotación estratégica en BYMA.",
    "tipoCambio": "Expectativa CCL sostenida.",
    "perspectivas": "Catalizador local del cuatrimestre."
  },
  "tonoMercado": "risk-on|risk-off|rotacion_defensiva|neutral",
  "top5Comprar": [
    {
      "ticker": "SYMBOL",
      "nombre": "Empresa",
      "tipo": "accion_arg o cedear",
      "precioReferencia": "precio/N/A",
      "motivo": "Tesis técnica y fundamental exacta.",
      "riesgos": "Punto débil de la tesis / Qué rompe el trade.",
      "variables": "Los 3 métricas o indicadores clave usados.",
      "horizonte": "corto|mediano|largo",
      "confianza": 9
    }
  ],
  "recomendacionesVenta": [
    {
      "ticker": "SYMBOL",
      "motivo": "Motivo irrefutable de venta.",
      "urgencia": "alta|media|baja"
    }
  ],
  "alertas": ["El mayor riesgo actual para un inversor long."]
}`;
}

const PORTFOLIO_FILE = join(__dirname, 'mi-portafolio.json');

// ---------- PORTFOLIO PERSISTENCE ----------
function readPortfolioFile() {
  if (existsSync(PORTFOLIO_FILE)) {
    try {
      return JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf-8'));
    } catch (e) {
      console.error('Error reading portfolio file:', e);
      return [];
    }
  }
  return [];
}

function writePortfolioFile(data) {
  try {
    writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Error writing portfolio file:', e);
    return false;
  }
}

// Get portfolio from disk
app.get('/api/portfolio', (req, res) => {
  const data = readPortfolioFile();
  res.json(data);
});

// Save portfolio to disk
app.post('/api/portfolio', (req, res) => {
  const data = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: 'Data must be a JSON array' });
  }
  const ok = writePortfolioFile(data);
  if (ok) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: 'Failed to save portfolio to disk' });
  }
});

// ---------- API ROUTES ----------

// Market Analysis (main endpoint)
app.post('/api/market-analysis', async (req, res) => {
  try {
    const { portfolio, aiProvider = 'gemini', riskProfile = 'moderado' } = req.body || {};

    // Validate keys for requested provider
    if (aiProvider === 'gemini' && !GEMINI_KEY) {
      return res.status(500).json({ error: 'API key de Gemini no configurada.' });
    }
    if (aiProvider === 'openai' && !OPENAI_KEY) {
      return res.status(500).json({ error: 'API key de OpenAI no configurada.' });
    }
    if (aiProvider === 'anthropic' && !ANTHROPIC_KEY) {
      return res.status(500).json({ error: 'API key de Anthropic no configurada.' });
    }
    if (aiProvider === 'consensus' && (!GEMINI_KEY || !OPENAI_KEY)) {
      return res.status(500).json({ error: 'Faltan API keys para el consenso (se necesitan de Google y OpenAI).' });
    }
    if (!FINNHUB_KEY) {
      return res.status(500).json({ error: 'Finnhub API key no configurada.' });
    }

    // Check cache (only if same portfolio and same AI provider)
    const cacheKey = JSON.stringify({ portfolio: portfolio || [], provider: aiProvider, riskProfile });
    if (
      analysisCache.data &&
      Date.now() - analysisCache.timestamp < CACHE_TTL &&
      analysisCache.portfolioKey === cacheKey
    ) {
      return res.json({ ...analysisCache.data, cached: true });
    }

    // Fetch global data from Finnhub in parallel
    const globalPromises = [
      getMarketNews().catch(() => []),
      getIndexQuotes()
    ];

    // Fetch individual data for each stock in portfolio
    let portfolioEnriched = [];
    if (portfolio && portfolio.length > 0) {
      // Limit to 10 tickers to avoid Finnhub rate limits on free tier
      const uniqueTickers = [...new Set(portfolio.map(p => p.ticker))].slice(0, 10);
      
      const enrichmentPromises = uniqueTickers.map(async (ticker) => {
        const [metric, news] = await Promise.all([
          getBasicFinancials(ticker).catch(() => ({})),
          getCompanyNews(ticker).catch(() => [])
        ]);
        return { ticker, metric: metric.metric || {}, news: (news || []).slice(0, 2) };
      });
      globalPromises.push(Promise.all(enrichmentPromises).then(r => portfolioEnriched = r));
    }

    const [news, indices] = await Promise.all(globalPromises);

    // Generate AI analysis
    let text = '';

    if (aiProvider === 'consensus') {
      const basicPrompt = buildAnalysisPrompt(news, indices, portfolio, portfolioEnriched, riskProfile) + "\n\nPor favor, provee tu análisis general del mercado y recomendaciones (no necesitas formato JSON).";
      
      console.log('--- Iniciando Consenso de IAs (Gemini + OpenAI) ---');
      const [geminiRes, openaiRes] = await Promise.all([
        genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' }).generateContent(basicPrompt).then(r => r.response.text()).catch(e => 'Error Gemini: ' + e),
        openaiClient.chat.completions.create({ model: 'gpt-5.4', messages: [{ role: 'user', content: basicPrompt }] }).then(c => c.choices[0].message.content).catch(e => 'Error OpenAI: ' + e)
      ]);

      const consensusPrompt = `Eres un juez y analista jefe de inversiones. A continuación, tienes los reportes de DOS agencias de inteligencia artificial (Gemini y OpenAI) sobre el mismo portafolio y estado de mercado actual.
      Tu tarea es encontrar los puntos en común, resolver las contradicciones (si las hay), y entregar un veredicto o consenso maestro alineado explícitamente al perfil de riesgo: ${riskProfile.toUpperCase()}.

      REPORTE GEMINI:
      ${geminiRes}

      REPORTE OPENAI:
      ${openaiRes}

      Basándote en estos DOS reportes, genera el análisis final y responde de forma estricta respetando el siguiente formato JSON que se esperaba originalmente:
      {
        "tonoMercado": "alcista/bajista/neutral/volatil",
        "resumenEjecutivo": "texto describiendo el consenso",
        "analisisGlobal": { "tendencia": "...", "factoresClave": ["..."] },
        "analisisArgentina": { "tendencia": "...", "factoresClave": ["..."] },
        "recomendacionPortafolio": "texto",
        "top5Comprar": [{ "ticker": "AAA", "razon": "...", "horizonte": "...", "riesgo": "..." }],
        "recomendacionesVenta": [{ "ticker": "BBB", "razon": "..." }],
        "alertas": ["alerta 1", "alerta 2"]
      }`;

      console.log('--- Modelos respondieron. Sintetizando consenso con gpt-5.4 ---');
      const masterCompletion = await openaiClient.chat.completions.create({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: consensusPrompt }],
        max_completion_tokens: 4000,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      });
      text = masterCompletion.choices[0].message.content;
      console.log('--- Consenso finalizado ---');

    } else if (aiProvider === 'anthropic') {
      const prompt = buildAnalysisPrompt(news, indices, portfolio, portfolioEnriched, riskProfile);
      const completion = await anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2500,
        system: "Debes responder única y exclusivamente con un objeto JSON válido, sin delimitadores blockcode markdown si no es necesario.",
        messages: [{ role: 'user', content: prompt }]
      });
      text = completion.content[0].text;
    } else if (aiProvider === 'openai') {
      const prompt = buildAnalysisPrompt(news, indices, portfolio, portfolioEnriched, riskProfile);
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 4000,
        temperature: 0.2, // slightly lower for consistent JSON
        response_format: { type: 'json_object' }
      });
      text = completion.choices[0].message.content;
    } else { // 'gemini'
      const prompt = buildAnalysisPrompt(news, indices, portfolio, portfolioEnriched, riskProfile) + '\n\nIMPORTANTE: Responde ÚNICAMENTE con JSON válido, sin delimitadores ```json, sin comillas invertidas y sin texto adicional antes o después del objeto JSON. El primer caracter de tu respuesta debe ser { y el último debe ser }.';
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
      const result = await model.generateContent(prompt);
      text = result.response.text();
    }

    // Parse JSON response
    let analysis;
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', text.substring(0, 500));
      return res.status(500).json({
        error: 'Error al parsear la respuesta de IA',
        rawResponse: text.substring(0, 1000)
      });
    }

    // Cache the result
    analysisCache = {
      data: { analysis, newsCount: news.length, timestamp: new Date().toISOString() },
      timestamp: Date.now(),
      portfolioKey: cacheKey
    };

    res.json({ analysis, newsCount: news.length, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get quote for a symbol
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const quote = await getQuote(req.params.symbol.toUpperCase());
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get market news
app.get('/api/news', async (req, res) => {
  try {
    const news = await getMarketNews();
    res.json(news.slice(0, 30));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search for symbols
app.get('/api/search/:query', async (req, res) => {
  try {
    const results = await searchSymbol(req.params.query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Company-specific news
app.get('/api/company-news/:symbol', async (req, res) => {
  try {
    const news = await getCompanyNews(req.params.symbol.toUpperCase());
    res.json(news.slice(0, 15));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Index quotes
app.get('/api/indices', async (req, res) => {
  try {
    const indices = await getIndexQuotes();
    res.json(indices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Invalidate cache (force refresh)
app.post('/api/refresh', (req, res) => {
  analysisCache = { data: null, timestamp: 0 };
  res.json({ ok: true, message: 'Cache invalidado. El próximo análisis será fresco.' });
});

// Get real-time CEDEAR quotes in ARS (from data912)
app.get('/api/cedears', async (req, res) => {
  try {
    const response = await fetch('https://data912.com/live/arg_cedears');
    if (!response.ok) throw new Error(`Data912 error: ${response.status}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Error fetching data912:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`\n🚀 InvestAI Server running on http://localhost:${PORT}`);
  console.log(`📊 Finnhub API: ${FINNHUB_KEY ? '✅ Configurada' : '❌ Falta configurar'}`);
  console.log(`🤖 Gemini API: ${GEMINI_KEY ? '✅ Configurada' : '❌ Falta configurar'}`);
  console.log(`🧠 OpenAI API: ${OPENAI_KEY ? '✅ Configurada' : '❌ Falta configurar'}`);
  console.log(`\nAbrí http://localhost:${PORT} en tu navegador.\n`);
});
