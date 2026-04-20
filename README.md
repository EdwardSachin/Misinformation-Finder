# Misinformation-Finder

## Overview
Misinformation-Finder is a Chrome extension and Node.js backend that detects and highlights misinformation on websites, audio, and video content. It leverages Google Cloud Speech-to-Text and Gemini AI for advanced analysis, providing confidence metrics and sentiment analysis.

## Features
- **Website Scanning:** Extracts main content from web pages and checks for misinformation.
- **Audio/Video Analysis:** Transcribes and analyzes uploaded audio and video files for misinformation.
- **Context Menu:** Right-click to verify selected text on any website.
- **Side Panel UI:** Interactive Chrome extension side panel for scanning, history, and media uploads.
- **Confidence & Sentiment:** Displays confidence scores and sentiment for detected claims.
- **History:** Keeps a local history of scans for user reference.

## Project Structure
- `project-root/extention/` — Chrome extension source (UI, content/background scripts)
- `project-root/gcloud/` — Node.js backend (Express server, Google Cloud integration)

## Backend Setup (Node.js)
1. Install dependencies:
	```bash
	cd project-root/gcloud
	npm install
	```
2. Set up your Google Cloud credentials and Gemini API key in a `.env` file:
	```env
	GEMINI_API_KEY=your_gemini_api_key
	GOOGLE_APPLICATION_CREDENTIALS=path/to/your/stt-key.json
	```
3. Start the server:
	```bash
	npm start
	```
	The server runs on `http://localhost:5000`.

## Chrome Extension Setup
1. Go to `chrome://extensions` and enable Developer Mode.
2. Click "Load unpacked" and select the `project-root/extention` folder.
3. The extension icon will appear in your browser.

## Usage
- Click the extension icon to open the side panel.
- Use "Scan Website" to analyze the current page.
- Upload audio/video files for analysis in the "Media" tab.
- Use the context menu to verify selected text.

## Technologies Used
- Node.js, Express, Google Cloud Speech-to-Text, Gemini AI
- Chrome Extension APIs (Manifest V3)
- JavaScript, HTML, CSS

## Security
**Important:** Do not commit your Google Cloud credentials (`stt-key.json`) to version control. This file is ignored via `.gitignore`.

## License
MIT
