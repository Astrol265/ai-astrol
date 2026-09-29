const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const HOST = "0.0.0.0";

const COINS = [
  { id: "bitcoin", symbol: "BTC/USD", emoji: "₿" },
  { id: "ethereum", symbol: "ETH/USD", emoji: "Ξ" },
  { id: "binancecoin", symbol: "BNB/USD", emoji: "◆" },
  { id: "solana", symbol: "SOL/USD", emoji: "◎" },
  { id: "ripple", symbol: "XRP/USD", emoji: "✕" },
  { id: "dogecoin", symbol: "DOGE/USD", emoji: "Ð" },
  { id: "cardano", symbol: "ADA/USD", emoji: "₳" },
  { id: "avalanche-2", symbol: "AVAX/USD", emoji: "▲" }
];

const cache = { data: null, at: 0 };
const CACHE_MS = 20000;

function json(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(out);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1000000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function getMarketData() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) return cache.data;

  const ids = COINS.map(x => x.id).join(",");
  const url =
    "https://api.coingecko.com/api/v3/coins/markets" +
    "?vs_currency=usd&ids=" + encodeURIComponent(ids) +
    "&order=market_cap_desc&per_page=100&page=1&sparkline=true" +
    "&price_change_percentage=1h,24h";

  const r = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "Astro-Signals/1.0" }
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error("Market-data provider returned HTTP " + r.status + (txt ? ": " + txt.slice(0,120) : ""));
  }

  const raw = await r.json();

  const markets = raw.map(c => {
    const prices = Array.isArray(c.sparkline_in_7d?.price) ? c.sparkline_in_7d.price : [];
    const recent = prices.slice(-48);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const mid = recent.length ? recent[Math.floor(recent.length / 2)] : null;

    const momentum = first && last
      ? clamp(Math.abs((last / first - 1) * 100) * 18, 0, 100)
      : clamp(Math.abs(c.price_change_percentage_1h_in_currency || 0) * 12, 0, 100);

    const trendRaw = first && last
      ? ((last - first) / first) * 100
      : (c.price_change_percentage_24h || 0);
    const trend = clamp(50 + trendRaw * 8, 0, 100);

    let volatility = 0;
    if (recent.length > 5) {
      const returns = [];
      for (let i = 1; i < recent.length; i++) {
        if (recent[i-1]) returns.push((recent[i] / recent[i-1] - 1) * 100);
      }
      const mean = returns.reduce((a,b)=>a+b,0) / (returns.length || 1);
      const variance = returns.reduce((a,b)=>a + Math.pow(b-mean,2),0) / (returns.length || 1);
      volatility = clamp(Math.sqrt(variance) * 25, 0, 100);
    }

    const direction = trendRaw >= 0 ? "UP" : "DOWN";
    const signalStrength = (momentum * 0.35) + (Math.abs(trend - 50) * 0.45) + ((100 - volatility) * 0.20);
    const confidence = Math.round(clamp(50 + signalStrength * 0.45, 50, 94));

    const known = COINS.find(x => x.id === c.id) || {};
    const quality = c.current_price && c.total_volume && c.market_cap ? 96 : 70;

    return {
      id: c.id,
      symbol: known.symbol || (c.symbol || "").toUpperCase() + "/USD",
      emoji: known.emoji || "•",
      price: formatPrice(c.current_price),
      rawPrice: c.current_price,
      change24h: round(c.price_change_percentage_24h || 0, 2),
      momentum: round(momentum, 1),
      trend: round(trend, 1),
      volatility: round(volatility, 1),
      dataQuality: quality,
      direction,
      confidence,
      timestamp: new Date().toISOString()
    };
  }).sort((a,b) => b.confidence - a.confidence);

  cache.data = markets;
  cache.at = now;
  return markets;
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function round(n, d=2) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
function formatPrice(n) {
  if (n == null) return "N/A";
  if (n >= 1000) return "$" + n.toLocaleString("en-US", {maximumFractionDigits:2});
  if (n >= 1) return "$" + n.toFixed(2);
  if (n >= 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(8);
}

async function evaluate(signal) {
  if (!signal || !signal.id) throw new Error("Missing signal");
  const markets = await getMarketData();
  const current = markets.find(x => x.id === signal.id);
  if (!current) throw new Error("The instrument is no longer available");

  const entry = Number(signal.rawPrice);
  const exit = Number(current.rawPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) {
    throw new Error("Missing real price data for evaluation");
  }

  const change = (exit - entry) / entry;
  const success = signal.direction === "UP" ? change > 0 : change < 0;

  return {
    success,
    entryPrice: entry,
    exitPrice: exit,
    priceChangePct: round(change * 100, 4),
    evaluatedAt: new Date().toISOString(),
    source: "CoinGecko live market data"
  };
}

async function askGemini(question, markets, signal) {
  if (!GEMINI_API_KEY) {
    return "Gemini is not configured on this deployment. Add GEMINI_API_KEY in Render → Environment, then redeploy.";
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: "CoinGecko live market data",
    markets: (markets || []).slice(0, 10),
    activeSignal: signal || null
  };

  const prompt = `You are Astro AI, a market-data explanation assistant.
Use ONLY the supplied market snapshot for factual market claims.
Do not invent prices, news, indicators, probabilities, or events.
Do not claim certainty or guarantee a trade result.
If the snapshot does not contain enough information, say so.
Explain the data clearly and briefly.

USER QUESTION:
${String(question).slice(0, 3000)}

LIVE SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
    })
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "Gemini request failed");

  const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  return answer || "Gemini returned no answer.";
}

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "Astro Signals",
        marketData: "CoinGecko",
        geminiConfigured: Boolean(GEMINI_API_KEY),
        timeZone: "UTC-4"
      });
    }

    if (req.method === "GET" && url.pathname === "/api/scan") {
      const markets = await getMarketData();
      return json(res, 200, {
        markets,
        source: "CoinGecko live market data",
        fetchedAt: new Date().toISOString()
      });
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const body = await readBody(req);
      return json(res, 200, await evaluate(body.signal));
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const answer = await askGemini(body.question, body.markets, body.signal);
      return json(res, 200, { answer });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      return res.end(html);
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Astro Signals running on ${HOST}:${PORT}`);
});
