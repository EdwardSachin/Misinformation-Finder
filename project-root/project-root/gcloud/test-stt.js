 const fs = require("fs");
const metadata = require("audio-metadata");
const speech = require("@google-cloud/speech");


// Path to your service account key
process.env.GOOGLE_APPLICATION_CREDENTIALS = "C:/Users/Edward Sachin/OneDrive/Desktop/gcloud/stt-key.json";


// Creates a client
const client = new speech.SpeechClient();


// The name of the audio file to transcribe
const filename = "hello.mp3"; // Put hello.mp3 in the same folder


// Step 1: Detect metadata
const buffer = fs.readFileSync(filename);
let sampleRate = 16000; // default fallback


try {
  const info = metadata.id3v2(buffer);
  if (info && info.format && info.format.sampleRate) {
    sampleRate = info.format.sampleRate;
    console.log("Detected sample rate:", sampleRate);
  } else {
    console.log("⚠️ Could not detect sample rate, using default:", sampleRate);
  }
} catch (e) {
  console.log("⚠️ Metadata read failed, using default:", sampleRate);
}


// Step 2: Convert file to base64
const audioBytes = buffer.toString("base64");


const audio = {
  content: audioBytes,
};


// Step 3: Configure request
const config = {
  encoding: "MP3",
  sampleRateHertz: sampleRate, // detected or default
  languageCode: "en-US",
};


const request = {
  audio: audio,
  config: config,
};


// Step 4: Transcribe
async function transcribe() {
  try {
    const [response] = await client.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join("\n");
    console.log(`\n📝 Transcription: ${transcription}`);
  } catch (err) {
    console.error("❌ ERROR:", err);
  }
}


transcribe();                 