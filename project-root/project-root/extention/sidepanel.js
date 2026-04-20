document.addEventListener("DOMContentLoaded", () => {
  const SERVER_URL = "http://localhost:5000";
  const resultBox = document.getElementById("result");
  const scanBtn = document.getElementById("scanWebsite");
  const deepScanToggle = document.getElementById("deepScanToggle");
  const uploadAudioInput = document.getElementById("uploadAudio");
  const uploadAudioBtn = document.getElementById("uploadAudioBtn");
  const uploadVideoInput = document.getElementById("uploadVideo");
  const uploadVideoBtn = document.getElementById("uploadVideoBtn");
  const checkMicBtn = document.getElementById("checkMic");
  const videoProgress = document.getElementById("videoProgress");
  const videoProgressFill = document.getElementById("videoProgressFill");
  const videoStatus = document.getElementById("videoStatus");
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const historyList = document.getElementById("historyList");

  let deepScan = false;
  let lastRequestTime = 0;
  const debounceInterval = 2000;
  let uploadedAudioBase64 = null;
  let uploadedVideoFile = null;
  let isMicActive = false;
  let audioContext, analyser, mediaRecorder, micStream;
  let chunks = [];
  let scanHistory = [];

  // Initialize from storage
  chrome.storage.local.get(['scanHistory'], (result) => {
    if (result.scanHistory) {
      scanHistory = result.scanHistory;
      updateHistoryDisplay();
    }
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const tabId = tab.getAttribute("data-tab");

      // Update active tab
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      // Show corresponding content
      tabContents.forEach(content => {
        content.classList.remove("active");
        if (content.id === `${tabId}-tab`) {
          content.classList.add("active");
        }
      });
    });
  });

  // ------------------- TOGGLE DEEP SCAN -------------------
  deepScanToggle.addEventListener("click", () => {
    deepScan = !deepScan;
    deepScanToggle.innerHTML = deepScan
      ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Deep Scan'
      : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> Normal Scan';
  });

  // ------------------- WEBSITE SCAN -------------------
  scanBtn.addEventListener("click", async () => {
    const now = Date.now();
    if (now - lastRequestTime < debounceInterval) {
      showNotification("Please wait before scanning again...", "warning");
      return;
    }
    lastRequestTime = now;

    showLoading(deepScan
      ? "Deep scanning website for misinformation..."
      : "Scanning website for misinformation...");

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      try {
        if (!tabs[0]?.id) return;

        chrome.tabs.sendMessage(tabs[0].id, { action: "fetchMainText" }, async (response) => {
          // Check for connection error (orphaned script)
          if (chrome.runtime.lastError) {
            showNotification("Please refresh the page and try again.", "error");
            return;
          }

          if (!response || !response.text || response.text.length < 50) {
            showNotification("No readable text found on this page.", "error");
            return;
          }

          const sentences = response.text
            .split(/[.\n!]/)
            .map((t) => t.trim())
            .filter((t) => t.length > 12)
            .slice(0, deepScan ? 80 : 18);

          let abortController = new AbortController();
          let timeoutHandle = setTimeout(() => {
            abortController.abort();
            showNotification("Scan timed out. Try again.", "error");
          }, 180000);

          try {
            const res = await fetch(`${SERVER_URL}/verify-text`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                claims: sentences,
                deepScan,
                source: "website",
                url: tabs[0].url
              }),
              signal: abortController.signal,
            });

            clearTimeout(timeoutHandle);
            const data = await res.json();

            if (!data.results || data.results.length === 0) {
              showNotification("No misinformation detected.", "success");
              addToHistory({
                type: "website",
                url: tabs[0].url,
                date: new Date().toISOString(),
                results: [],
                status: "clean"
              });
              return;
            }

            // Highlight + render results
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "highlightMisinformation",
              data: data.results,
            });

            resultBox.innerHTML = "";

            // SIDE PANEL FILTER: Only show "Misinformation" (>= 0.3)
            // True info (Green) is highlighted on page but hidden here.
            const visibleResults = data.results.filter(item => item.harm_score >= 0.3);

            if (visibleResults.length === 0) {
              showNotification("No misinformation detected.", "success");
            } else {
              visibleResults.forEach((item) => renderResultItem(item));
            }

            // Add to history
            addToHistory({
              type: "website",
              url: tabs[0].url,
              date: new Date().toISOString(),
              results: data.results,
              status: data.results.length > 0 ? "misinformation" : "clean"
            });
          } catch (err) {
            showNotification("Failed or timed out. Check server/API.", "error");
          }
        });
      } catch (err) {
        showNotification("Error accessing tab content.", "error");
      }
    });
  });

  // ------------------- MICROPHONE RECORDING -------------------
  checkMicBtn.addEventListener("click", async () => {
    if (isMicActive) {
      stopRecording();
      return;
    }

    isMicActive = true;
    checkMicBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg> Stop Recording';
    showNotification("Recording... Speak now", "info");

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;

      const source = audioContext.createMediaStreamSource(micStream);
      source.connect(analyser);

      mediaRecorder = new MediaRecorder(micStream, { mimeType: "audio/webm" });
      chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        audioContext.close();
        micStream.getTracks().forEach((t) => t.stop());
        isMicActive = false;
        checkMicBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Record Audio';

        const blob = new Blob(chunks, { type: "audio/webm" });
        const buffer = await blob.arrayBuffer();
        const base64Audio = arrayBufferToBase64(buffer);

        showLoading("Transcribing audio...");
        try {
          const res = await fetch(`${SERVER_URL}/transcribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64Audio }),
          });
          const { text, claims } = await res.json();

          if (!text || text.trim().length < 2) {
            showNotification("No input detected. Please try again.", "warning");
            return;
          }

          showLoading("Fact-checking...");
          const verifyRes = await fetch(`${SERVER_URL}/verify-text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              claims: claims || [text],
              source: "audio",
              transcription: text
            }),
          });
          const verifyData = await verifyRes.json();

          if (!verifyData.results || verifyData.results.length === 0) {
            showNotification("No misinformation detected.", "success");
            addToHistory({
              type: "audio",
              date: new Date().toISOString(),
              transcription: text,
              results: [],
              status: "clean"
            });
            return;
          }

          resultBox.innerHTML = "";
          verifyData.results.forEach((item) => renderResultItem(item));

          // Add to history
          addToHistory({
            type: "audio",
            date: new Date().toISOString(),
            transcription: text,
            results: verifyData.results,
            status: verifyData.results.length > 0 ? "misinformation" : "clean"
          });
        } catch (err) {
          showNotification("Transcription failed: " + err.message, "error");
        }
      };

      mediaRecorder.start();
      detectSilence();
    } catch (err) {
      isMicActive = false;
      checkMicBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg> Record Audio';
      showNotification("Mic access error: " + err.message, "error");
    }
  });

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }

  // ------------------- AUDIO FILE UPLOAD -------------------
  uploadAudioInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) {
      uploadedAudioBase64 = null;
      uploadAudioBtn.disabled = true;
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      showNotification("Audio file too large (max 10MB)", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = function () {
      uploadedAudioBase64 = reader.result.split(",")[1];
      uploadAudioBtn.disabled = false;
      showNotification(`Audio file loaded: ${file.name}`, "success");
    };
    reader.readAsDataURL(file);
  });

  uploadAudioBtn.addEventListener("click", async () => {
    if (!uploadedAudioBase64) {
      showNotification("Please select an audio file first.", "warning");
      return;
    }

    showLoading("Transcribing audio...");
    try {
      const transcribeRes = await fetch(`${SERVER_URL}/transcribe-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: uploadedAudioBase64 }),
      });

      const { text, claims } = await transcribeRes.json();
      if (!text) {
        showNotification("Transcription failed or empty result.", "error");
        return;
      }

      showLoading("Fact-checking...");
      const verifyRes = await fetch(`${SERVER_URL}/verify-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claims: claims || [text],
          source: "audio_file",
          transcription: text
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyData.results || verifyData.results.length === 0) {
        showNotification("No misinformation detected.", "success");
        addToHistory({
          type: "audio_file",
          date: new Date().toISOString(),
          transcription: text,
          results: [],
          status: "clean"
        });
        return;
      }

      resultBox.innerHTML = "";
      verifyData.results.forEach((item) => renderResultItem(item));

      // Add to history
      addToHistory({
        type: "audio_file",
        date: new Date().toISOString(),
        transcription: text,
        results: verifyData.results,
        status: verifyData.results.length > 0 ? "misinformation" : "clean"
      });
    } catch (err) {
      showNotification("Error during processing: " + err.message, "error");
    }
  });

  // ------------------- VIDEO FILE UPLOAD -------------------
  uploadVideoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) {
      uploadedVideoFile = null;
      uploadVideoBtn.disabled = true;
      return;
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      showNotification("Video file too large (max 50MB)", "error");
      return;
    }

    uploadedVideoFile = file;
    uploadVideoBtn.disabled = false;
    showNotification(`Video file loaded: ${file.name}`, "success");
  });

  uploadVideoBtn.addEventListener("click", async () => {
    if (!uploadedVideoFile) {
      showNotification("Please select a video file first.", "warning");
      return;
    }

    // Show progress UI
    videoProgress.style.display = "block";
    videoStatus.querySelector("span:last-child").textContent = "Processing video...";
    videoStatus.querySelector(".status-dot").style.background = "var(--primary)";

    const formData = new FormData();
    formData.append("video", uploadedVideoFile);

    try {
      // Simulate progress (real progress would need more advanced handling)
      simulateProgress(videoProgressFill);

      const res = await fetch(`${SERVER_URL}/process-video`, {
        method: "POST",
        body: formData,
      });

      videoProgress.style.display = "none";

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const data = await res.json();

      if (data.error) {
        showNotification("Video processing error: " + data.error, "error");
        return;
      }

      if (!data.results || data.results.length === 0) {
        showNotification("No misinformation detected in video.", "success");
        addToHistory({
          type: "video",
          date: new Date().toISOString(),
          filename: uploadedVideoFile.name,
          results: [],
          status: "clean"
        });
        return;
      }

      resultBox.innerHTML = "";
      data.results.forEach((item) => renderResultItem(item));

      // Add to history
      addToHistory({
        type: "video",
        date: new Date().toISOString(),
        filename: uploadedVideoFile.name,
        results: data.results,
        status: data.results.length > 0 ? "misinformation" : "clean"
      });

    } catch (err) {
      videoProgress.style.display = "none";
      showNotification("Video processing failed: " + err.message, "error");
    }
  });

  // ------------------- SILENCE DETECTION -------------------
  const SILENCE_RMS_THRESHOLD = 0.015;
  const SILENCE_DURATION = 2500;
  function detectSilence() {
    let silentFrames = 0;
    const INTERVAL = 200;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    function analyze() {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        let normalized = dataArray[i] / 128 - 1;
        sum += normalized * normalized;
      }
      let rms = Math.sqrt(sum / bufferLength);

      if (rms < SILENCE_RMS_THRESHOLD) {
        silentFrames += INTERVAL;
        if (silentFrames >= SILENCE_DURATION && mediaRecorder.state === "recording") {
          mediaRecorder.stop();
          return;
        }
      } else {
        silentFrames = 0;
      }
      if (mediaRecorder.state === "recording") setTimeout(analyze, INTERVAL);
    }
    analyze();
  }

  // ------------------- HISTORY MANAGEMENT -------------------
  function addToHistory(scanData) {
    scanHistory.unshift(scanData);
    // Keep only last 20 scans
    if (scanHistory.length > 20) {
      scanHistory = scanHistory.slice(0, 20);
    }

    chrome.storage.local.set({ scanHistory });
    updateHistoryDisplay();
  }

  function updateHistoryDisplay() {
    if (scanHistory.length === 0) {
      historyList.innerHTML = '<p class="empty-state">No scan history yet</p>';
      return;
    }

    historyList.innerHTML = '';
    scanHistory.forEach((item, index) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'misinfo-block';

      let title = '';
      let content = '';

      switch (item.type) {
        case 'website':
          title = `Website Scan: ${new URL(item.url).hostname}`;
          content = `Scanned on ${new Date(item.date).toLocaleString()}`;
          break;
        case 'audio':
        case 'audio_file':
          title = 'Audio Scan';
          const preview = item.transcription.length > 100
            ? item.transcription.substring(0, 100) + '...'
            : item.transcription;
          content = `"${preview}" - ${new Date(item.date).toLocaleString()}`;
          break;
        case 'video':
          title = `Video Scan: ${item.filename}`;
          content = `Scanned on ${new Date(item.date).toLocaleString()}`;
          break;
      }

      historyItem.innerHTML = `
        <div class="misinfo-claim-title">${title}</div>
        <div class="misinfo-claim">${content}</div>
        <div class="misinfo-label" style="background: ${item.status === 'clean' ? 'var(--success)' : 'var(--danger)'}; color: white;">
          ${item.status === 'clean' ? 'Clean' : 'Misinformation Found'}
        </div>
        <button class="view-details" data-index="${index}">View Details</button>
      `;

      historyList.appendChild(historyItem);
    });

    // Add event listeners to view details buttons
    document.querySelectorAll('.view-details').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = e.target.getAttribute('data-index');
        viewHistoryDetails(scanHistory[index]);
      });
    });
  }

  function viewHistoryDetails(historyItem) {
    resultBox.innerHTML = '';

    if (historyItem.results && historyItem.results.length > 0) {
      historyItem.results.forEach((item) => renderResultItem(item));
    } else {
      resultBox.innerHTML = '<div class="empty-state">No misinformation detected in this scan</div>';
    }

    // Switch to result view
    document.querySelector('[data-tab="website"]').click();
  }

  // ------------------- UI HELPERS -------------------
  function showLoading(message = "Processing...") {
    resultBox.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>${message}</div>
      </div>
    `;
  }

  function showNotification(message, type = "info") {
    resultBox.innerHTML = `
      <div class="misinfo-block ${type}">
        <div class="misinfo-claim">${message}</div>
      </div>
    `;

    // Auto-clear after 3 seconds if it's just a notification
    if (type !== "loading") {
      setTimeout(() => {
        if (resultBox.textContent === message) {
          resultBox.innerHTML = '<div class="empty-state">Ready to scan for misinformation...</div>';
        }
      }, 3000);
    }
  }

  function simulateProgress(element) {
    let width = 0;
    const interval = setInterval(() => {
      if (width >= 90) {
        clearInterval(interval);
        return;
      }
      width += 5;
      element.style.width = width + '%';
    }, 500);
  }

  // ------------------- UTILITY FUNCTIONS -------------------
  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function renderResultItem(item) {
    let severity, harmColor, harmLabel, sentimentClass;

    // Determine severity based on harm_score
    if (item.harm_score >= 0.8) {
      severity = "high";
      harmColor = "#e03434";
      harmLabel = "DANGEROUS MISINFORMATION";
    } else if (item.harm_score >= 0.5) {
      severity = "medium";
      harmColor = "#ffa500";
      harmLabel = "MISLEADING CONTENT";
    } else if (item.harm_score >= 0.3) {
      severity = "low";
      harmColor = "#ffe930";
      harmLabel = "POTENTIALLY MISLEADING";
    } else {
      severity = "true";
      harmColor = "#28a745";
      harmLabel = "ACCURATE INFORMATION";
    }

    // Determine sentiment
    if (item.sentiment) {
      sentimentClass = item.sentiment.toLowerCase();
    } else {
      // Fallback sentiment analysis based on harm score
      if (item.harm_score >= 0.7) {
        sentimentClass = "negative";
      } else if (item.harm_score >= 0.4) {
        sentimentClass = "neutral";
      } else {
        sentimentClass = "positive";
      }
    }

    const confidencePercent = Math.round((item.confidence || 0.7) * 100);

    const container = document.createElement("div");
    container.className = `misinfo-block ${severity}`;
    container.innerHTML = `
      <div class="misinfo-claim-title">Claim</div>
      <div class="misinfo-claim">${item.claim}</div>
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin: 10px 0;">
        <span class="misinfo-label" style="background: ${harmColor}; color: white;">${harmLabel}</span>
        <span class="sentiment-badge ${sentimentClass}">
          <span>${sentimentClass === 'negative' ? '⚠️' : sentimentClass === 'positive' ? '✅' : '🔍'}</span>
          ${sentimentClass.toUpperCase()}
        </span>
      </div>

      <div style="background: rgba(0,0,0,0.03); padding: 8px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid ${harmColor};">
        <strong style="font-size: 0.8rem; display: block; margin-bottom: 2px;">Verdict:</strong>
        <span style="font-weight: 700; color: ${harmColor}; text-transform: uppercase;">${item.verdict || 'Unknown'}</span>
      </div>
      
      <div class="confidence-meter">
        <div class="confidence-fill" style="width: ${confidencePercent}%; background: ${harmColor};"></div>
      </div>
      <div style="font-size: 12px; color: #666; text-align: right;">Confidence: ${confidencePercent}%</div>
      
      <div class="misinfo-explanation-title">Analysis</div>
      <div class="misinfo-explanation">${item.explanation}</div>
      
      <div class="misinfo-explanation-title">Verified Information</div>
      <div class="misinfo-explanation">${item.correct_info}</div>
      
      ${item.sources && item.sources.length > 0 ? `
        <div class="misinfo-explanation-title">Sources</div>
        <div class="misinfo-explanation">${item.sources.join(', ')}</div>
      ` : ''}
    `;
    resultBox.appendChild(container);
  }
  // ------------------- CONTEXT MENU LISTENER -------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "analyzeSelection" && request.text) {
      // 1. Switch to Website Tab
      const websiteTab = document.querySelector('[data-tab="website"]');
      if (websiteTab) websiteTab.click();

      // 2. Show Loading
      showLoading("Analyzing selection...");

      // 3. Prepare claims
      const claims = request.text.split(/[.\n!]/).map(t => t.trim()).filter(t => t.length > 5);
      if (claims.length === 0) claims.push(request.text);

      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const url = tabs[0]?.url || "selection";
        try {
          const res = await fetch(`${SERVER_URL}/verify-text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              claims,
              deepScan: false,
              source: "selection",
              url
            })
          });
          const data = await res.json();
          resultBox.innerHTML = "";

          if (!data.results || data.results.length === 0) {
            showNotification("No misinformation found in selection.", "success");
          } else {
            // Show all results for explicit selection
            data.results.forEach((item) => renderResultItem(item));
          }
        } catch (e) {
          showNotification("Error analyzing selection.", "error");
        }
      });
    }
  });

});