import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || GEMINI_MODEL;
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Kore";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ASTROL_INSTRUCTIONS = `
You are AI Astrol, the user's personal AI assistant.
Personality: friendly, calm, smart, natural, and helpful. Address the user conversationally.
Try your best to answer questions directly and accurately. Do not make up facts.
When a question depends on current information, use Google Search grounding when useful and clearly distinguish current facts from uncertainty.
Explain things at the level the user needs. For simple questions, be concise. For complex questions, give useful detail.
You can help with learning, writing, coding, planning, calculations, general information and everyday tasks.
Never claim you completed an external action unless you actually did it.
`;

function requireKey(res) {
  if (!GEMINI_API_KEY) {
    res.status(500).json({ error: "GEMINI_API_KEY is missing on the server." });
    return false;
  }
  return true;
}

async function geminiGenerate({ model, contents, config = {}, useSearch = false }) {
  const body = { contents, ...config };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Gemini API request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

function extractText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.filter(p => typeof p.text === "string")
    .map(p => p.text)
    .join("\n") || "";
}

function normalizeHistory(history) {
  return history
    .filter(x => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .slice(-20)
    .map(x => ({
      role: x.role === "assistant" ? "model" : "user",
      parts: [{ text: x.content }]
    }));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(GEMINI_API_KEY), provider: "Google Gemini" });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const message = String(req.body.message || "").trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    if (!message) return res.status(400).json({ error: "Message is required." });

    const contents = [
      { role: "user", parts: [{ text: ASTROL_INSTRUCTIONS }] },
      ...normalizeHistory(history),
      { role: "user", parts: [{ text: message }] }
    ];

    const data = await geminiGenerate({
      model: GEMINI_MODEL,
      contents,
      config: {
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      },
      useSearch: process.env.GEMINI_ENABLE_SEARCH !== "false"
    });

    const reply = extractText(data) || "I didn't get a text response from Gemini.";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "AI request failed." });
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!requireKey(res)) return;
    if (!req.file) return res.status(400).json({ error: "No audio received." });
    if (req.file.size > 14 * 1024 * 1024) return res.status(413).json({ error: "Audio recording is too large." });

    const mimeType = (req.file.mimetype || "audio/mp4").split(";")[0];
    const data = await geminiGenerate({
      model: GEMINI_TRANSCRIBE_MODEL,
      contents: [{
        role: "user",
        parts: [
          { text: "Generate an accurate transcript of the speech in this audio. Return only the spoken words, with no commentary." },
          { inlineData: { mimeType, data: req.file.buffer.toString("base64") } }
        ]
      }],
      config: { generationConfig: { temperature: 0 } },
      useSearch: false
    });

    res.json({ text: extractText(data).trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Transcription failed." });
  }
});

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

app.post("/api/tts", async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const text = String(req.body.text || "").trim().slice(0, 4096);
    if (!text) return res.status(400).json({ error: "Text is required." });

    const data = await geminiGenerate({
      model: GEMINI_TTS_MODEL,
      contents: [{
        role: "user",
        parts: [{
          text: `Speak this text warmly and naturally, like a friendly personal AI assistant. Moderate pace and clear pronunciation:\n\n${text}`
        }]
      }],
      config: {
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } }
          }
        }
      },
      useSearch: false
    });

    const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Gemini did not return audio.");

    const pcm = Buffer.from(part.inlineData.data, "base64");
    const wav = pcmToWav(pcm, 24000, 1, 16);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.send(wav);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Text-to-speech failed." });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`AI Astrol Gemini running on port ${PORT}`));
