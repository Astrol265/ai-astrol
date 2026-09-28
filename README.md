# AI Astrol — Gemini Free Tier Edition

This version replaces the OpenAI backend with Google's Gemini API.

## What it includes
- Dark-blue iPhone-friendly AI Astrol interface
- Gemini online AI chat
- Google Search grounding for current-information questions
- Microphone recording and Gemini audio transcription
- Voice answers using Gemini text-to-speech, with browser speech fallback
- Random welcome greetings
- Local conversation history
- "Hey Astro" / "Astro" wake listening while the web app is open
- PWA / Add to Home Screen support
- Gemini API key stays on the server

## Important about "free"
Google provides a Free Tier for eligible Gemini API models, but it has usage limits. Free does not mean unlimited. Check Google's current pricing/limits before heavy use.

## Setup
1. Get a Gemini API key from Google AI Studio.
2. Copy `.env.example` to `.env`.
3. Put your key into `.env`:
   `GEMINI_API_KEY=YOUR_KEY`
4. Install dependencies:
   `npm install`
5. Start:
   `npm start`
6. Open the app through the server URL. Do NOT open `public/index.html` directly because the `/api/*` backend must be running.

## iPhone
Microphone access normally requires HTTPS when hosted online. Add the hosted app to the iPhone Home Screen for a more app-like experience.

## Wake word limitation
A normal iPhone web app can keep "Hey Astro" listening while the page is open/active, but iOS does not allow an ordinary web page to continuously listen for a custom wake word after the app is fully closed or suspended. A native iOS implementation is needed for true system-level background wake behavior.
