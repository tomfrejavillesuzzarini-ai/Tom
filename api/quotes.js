/* api/quotes.js
   Vercel serverless function
   - Grouped fetch to Marketstack (one request for multiple symbols)
   - In-memory cache (5 minutes)
   - Retry/backoff for transient 429
   - Clear status handling for client (429) and upstream (502)
   Requires env var: MARKETSTACK_KEY
*/
const fetch = require('node-fetch');

const CACHE = new Map();
const TTL = 5 * 60 * 1000; // 5 minutes

function scoreItem(item, stats) {
  const z = (v, mean, sd) => sd ? (v - mean) / sd : 0;
  const scChange = z(item.changePct || 0, stats.meanChange, stats.sdChange || 1);
  const scVol = z(item.volume || 0, stats.meanVol, stats.sdVol || 1);
  return 50 + (scChange * 20) + (scVol * 15);
}

async function fetchWithRetry(url, attempts = 3, initialDelayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(url);
    if (r.ok || r.status === 404) return r;
    if (r.status === 429 && i < attempts - 1) {
      const delay = initialDelayMs * Math.pow(2, i);
      await new Promise(res => setTimeout(res, delay));
      continue;
    }
    return r;
  }
  return fetch(url);
}

module.exports = async (req, res) => {
  try {
    const key = process.env.MARKETSTACK_KEY || '';
    if (!key) {
      return res.status(500).json({ error: 'MARKETSTACK_KEY missing' });
    }

    const symbolsParam = (req.query && req.query.symbols) || '';
    if (!symbolsParam) {
      return res.status(400).json({ error: 'Missing symbols param' });
    }

    const symbols = symbolsParam.split(/[;,]/).map(s => s.trim()).filter(Boolean);
    if (!symbols.length) {
      return res.status(400).json({ error: 'No symbols provided' });
    }

    const cacheKey = symbols.join(';').toUpperCase();
    const now = Date.now();
    const cached = CACHE.get(cacheKey);
    if (cached && (now - cached.ts) < TTL) {
      return res.status(200).json({ cached: true, data: cached.data });
    }

    // Single grouped request (use comma-separated symbols for Marketstack)
    const url = `http://api.marketstack.com/v1/eod?access_key=${encodeURIComponent(key)}&symbols=${encodeURIComponent(symbols.join(','))}&limit=1`;
    const r = await fetchWithRetry(url);

    if (!r.ok) {
      const txt = await r.text();
      // Propagate rate limit clearly
      if (r.status === 429) {
        console.error('Marketstack rate limit:', txt);
        return res.status(429).json({ error: 'rate_limit', detail: txt });
      }
      console.error('Marketstack upstream error:', r.status, txt);
      return res.status(502).json({ error: 'upstream_error', detail: `Status ${r.status}: ${txt}` });
    }

    const json = await r.json();
    const dataArray = Array.isArray(json.data) ? json.data : [];

    // Map results back to requested symbols (case-insensitive match)
    const results = symbols.map(s => {
      const found = dataArray.find(x => x && String(x.symbol).toUpperCase() === String(s).toUpperCase());
      const d = found || null;
      const price = d ? d.close : null;
      const prevClose = d ? d.open : null;
      const changePct = (price != null && prevClose != null) ? ((price - prevClose) / prevClose) * 100 : null;
      const volume = d ? d.volume || null : null;
      return { symbol: s, name: d && d.symbol ? d.symbol : '', price, changePct, volume };
    });

    const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const sd = arr => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / (arr.length || 1)) || 0;
    };

    const stats = {
      meanChange: mean(results.map(r => r.changePct || 0)),
      sdChange: sd(results.map(r => r.changePct || 0)),
      meanVol: mean(results.map(r => r.volume || 0)),
      sdVol: sd(results.map(r => r.volume || 0))
    };

    const scored = results.map(r => ({ ...r, score: scoreItem(r, stats) }));

    CACHE.set(cacheKey, { ts: now, data: scored });
    return res.status(200).json({ cached: false, data: scored });
  } catch (err) {
    console.error('api/quotes error full:', err && err.stack ? err.stack : err);
    return res.status(502).json({ error: 'Upstream error', detail: String(err && err.message ? err.message : err) });
  }
};