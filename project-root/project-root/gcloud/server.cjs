const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const speech = require("@google-cloud/speech");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const FileType = require("file-type");
require("dotenv").config();

const app = express();
const PORT = 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));

// Initialize Google Cloud Speech Client
const speechClient = new speech.SpeechClient();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

console.log("✅ Server modules loaded. Starting endpoints...");

// ------------------- TRANSCRIBE AUDIO -------------------
app.post("/transcribe", async (req, res) => {
  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: "No audio provided" });
    }

    const audioBuffer = Buffer.from(audioBase64, "base64");
    const type = await FileType.fromBuffer(audioBuffer);

    let encoding = "WEBM_OPUS";
    let sampleRateHertz = 48000;

    if (type) {
      if (type.mime === "audio/mpeg") {
        encoding = "MP3";
        sampleRateHertz = 16000;
      } else if (type.mime === "audio/wav") {
        encoding = "LINEAR16";
        sampleRateHertz = 16000;
      } else if (type.mime === "audio/webm") {
        encoding = "WEBM_OPUS";
        sampleRateHertz = 48000;
      }
    }

    const audio = { content: audioBase64 };
    const config = { encoding, sampleRateHertz, languageCode: "en-US" };

    const [response] = await speechClient.recognize({ audio, config });
    const transcription = response.results
      .map((r) => r.alternatives[0].transcript)
      .join("\n");

    const claims = transcription
      .split(/(?<=\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    res.json({ text: transcription, claims });
  } catch (err) {
    console.error("❌ File transcription error:", err);
    res.status(500).json({ error: "File transcription failed" });
  }
});

// ------------------- VERIFY TEXT WITH ENHANCED ANALYSIS -------------------
app.post("/verify-text", async (req, res) => {
  try {
    const { claims, source, url, transcription } = req.body;
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return res.status(400).json({ error: "Invalid claims input" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Helper: Process a batch of claims
    const processChunk = async (chunkClaims) => {
      if (!chunkClaims.length) return [];

      const prompt = `
          Analyze the following sentences for misinformation. Identify specific claims that are False, Misleading, Partially True, or True.
          
          CRITICAL: The "claim" field MUST contain the EXACT, VERBATIM text from the input below. Do NOT paraphrase, rewrite, or summarize.
          If a sentence contains misinformation, copy that ENTIRE sentence word-for-word into the "claim" field.
          This is essential for text highlighting to work correctly.
          
          RETURN ONLY RAW JSON. No markdown. No explanations outside JSON.
          Response must be an array of objects:
          [
            {
              "claim": "THE EXACT VERBATIM TEXT FROM INPUT - DO NOT PARAPHRASE",
              "verdict": "False" | "Misleading" | "Partially True" | "True",
              "harm_score": 0.0 to 1.0 (0.8+ is red, 0.6+ orange, 0.3+ yellow, <0.3 green),
              "confidence": 0.0 to 1.0,
              "sentiment": "Positive" | "Negative" | "Neutral",
              "explanation": "Brief explanation",
              "correct_info": "Correct information",
              "sources": ["source1", "source2"]
            }
          ]

          Text to analyze:
          ${chunkClaims.join("\n")}
        `;

      try {
        const result = await model.generateContent(prompt);
        const responseAI = await result.response;
        let text = responseAI.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
      } catch (e) {
        console.error("Chunk failed:", e);
        return [];
      }
    };

    // Split into chunks of 15 for parallel processing
    const chunkSize = 15;
    const chunks = [];
    for (let i = 0; i < claims.length; i += chunkSize) {
      chunks.push(claims.slice(i, i + chunkSize));
    }

    console.log(`Processing ${claims.length} claims in ${chunks.length} batches...`);

    // Run sequentially to avoid 429 Rate Limit errors (Free Tier limits)
    let parsedResults = [];
    for (const [index, chunk] of chunks.entries()) {
      console.log(`Processing batch ${index + 1}/${chunks.length}...`);
      const chunkResult = await processChunk(chunk);
      parsedResults.push(...chunkResult);

      // Add a small delay between chunks to be nice to the API
      if (index < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Context & Filtering
    parsedResults = parsedResults.map(item => ({
      ...item,
      context: {
        source_type: source || "unknown",
        url: url || null
      }
    }));

    res.json({ results: parsedResults });
  } catch (err) {
    console.error("❌ Verify error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ------------------- PROCESS VIDEO FILES -------------------
app.post("/process-video", async (req, res) => {
  // Placeholder for video processing if needed or remove if unused in this flow
  res.json({ message: "Video processing not implemented yet" });
});

app.listen(PORT, () => {
  console.log(`✅ Advanced Misinformation Detector running at http://localhost:${PORT}`);
});