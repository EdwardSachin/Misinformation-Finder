# Website Misinformation Scanner Extension

## Overview
This project is a Chrome Extension and Node.js backend that allows users to scan websites for misinformation using AI. All audio and video features have been removed. The extension and backend now focus solely on text-based website scanning and verification.

## Features
- **Website Scanning**: Scan the content of the current website for misinformation or unverified claims.
- **Text Verification**: Uses AI to analyze and verify the accuracy of website text.
- **History**: View a history of previously scanned websites and results.
- **Simple UI**: Chrome extension side panel for easy access and results display.

## Removed Features
- Audio and video upload, transcription, and analysis
- All media-related endpoints and UI
- All dependencies related to audio/video processing

## How to Use
1. Install the Chrome extension from the `extention/` folder (load as unpacked in Chrome).
2. Start the backend server:
   ```
   cd project-root/gcloud
   npm install
   node server.cjs
   ```
3. Use the extension to scan websites and view results in the side panel.

## Project Structure
- `extention/` — Chrome extension source code (UI, content scripts, side panel)
- `gcloud/` — Node.js backend server (website scanning, AI verification)

## Requirements
- Node.js 18+
- Chrome browser (for extension)

## License
ISC
