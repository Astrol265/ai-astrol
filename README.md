# Astro Signals — UTC-4 + Real Market Data

This package runs Astro Signals as a single Node.js web service.

## What is included

- `server.js` — backend and API
- `index.html` — Astro Signals interface
- `package.json` — Render start configuration
- `.env.example` — environment variable example

## Real market data

The backend reads live cryptocurrency market data from CoinGecko's public API. It does not generate fake prices.

The current instruments are:
BTC/USD, ETH/USD, BNB/USD, SOL/USD, XRP/USD, DOGE/USD, ADA/USD and AVAX/USD.

## Gemini AI

The AI chat endpoint uses Gemini only when `GEMINI_API_KEY` is configured.

Do NOT put your API key inside `index.html` or commit it to GitHub.

## Render

Create a new Render Web Service from this GitHub repository.

Build Command:
npm install

Start Command:
npm start

Environment variable:
GEMINI_API_KEY = your Gemini API key

Optional:
GEMINI_MODEL = gemini-2.5-flash

No database is required.

## Important

The signal is an algorithmic market-data signal, not a guaranteed prediction. The 5-minute evaluation compares the signal's real entry price with later real market data. It is not a simulated price feed.

The displayed clock is UTC-4.
