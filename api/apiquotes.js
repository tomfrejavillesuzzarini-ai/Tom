// api/quotes.js - Vercel serverless function
// Simple proxy + in-memory cache + scoring using Marketstack
// Requires env var: MARKETSTACK_KEY
const fetch = require('node-fetch');

const CACHE = new Map();
const TTL = 30 * 1000; // 30s

function scoreItem(item, stats) {
  const z = (v, mean, sd) => sd ? (v - mean) / sd : 0;
  const scChange = z(item.changePct || 0, stats.meanChange, stats.sdChange || 1);
  const scVol = z(item.volume || 0, stats.meanVol, stats.sdVol || 1);
  return 50 + (scChange * 20) + (scVol * 15);
}

module.exports = async (req, res) => {
  const key = process.env.MARKETSTACK_KEY || '';
  if (!key) {
    res.status(500).json({ error: 'MARKETSTACK_KEY missing' });
    return;
  }

  const symbolsParam = (req.query && req.query.symbols) || '';
  if (!symbolsParam) {
    res.status(400).json({ error: 'Missing symbols param' });
    return;
  }

  const symbols = symbolsParam.split(';').map(s=>s.trim()).filter(Boolean);
  if (!symbols.length) {
    res.status(400).json({ error: 'No symbols provided' });
    return;
  }

  const cacheKey = symbols.join(';').toUpperCase();
  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && (now - cached.ts) < TTL) {
    res.status(200).json({ cached:true, data: cached.data });
    return;
  }

  try {
    const results = [];
    for (const s of symbols) {
      const url = `http://api.marketstack.com/v1/eod?access_key=${encodeURIComponent(key)}&symbols=${encodeURIComponent(s)}&limit=1`;
      const r = await fetch(url);
      const json = await r.json();
      const d = json && json.data && json.data[0] ? json.data[0] : null;
      const price = d ? d.close : null;
      const prevClose = d ? d.open : null;
      const changePct = (price != null && prevClose != null) ? ((price - prevClose) / prevClose) * 100 : null;
      const volume = d ? d.volume || null : null;
      results.push({ symbol: s, name: d && d.symbol ? d.symbol : '', price, changePct, volume });
    }

    const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length || 0;
    const sd = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s,x)=>s+Math.pow(x-m,2),0)/arr.length) || 0; };

    const stats = {
      meanChange: mean(results.map(r=>r.changePct || 0)),
      sdChange: sd(results.map(r=>r.changePct || 0)),
      meanVol: mean(results.map(r=>r.volume || 0)),
      sdVol: sd(results.map(r=>r.volume || 0))
    };

    const scored = results.map(r => ({ ...r, score: scoreItem(r, stats) }));

    CACHE.set(cacheKey, { ts: now, data: scored });
    res.status(200).json({ cached:false, data: scored });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Upstream error' });
  }
};