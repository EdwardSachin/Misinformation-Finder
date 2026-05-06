document.addEventListener("DOMContentLoaded", () => {
  const SERVER_URL = "http://localhost:5000";
  const resultBox = document.getElementById("result");
  const scanBtn = document.getElementById("scanWebsite");
  const deepScanToggle = document.getElementById("deepScanToggle");
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

  // Microphone/audio logic removed

  // Audio file upload logic removed

  // Video file upload logic removed

  // Silence detection logic removed

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
          // Audio and video history removed
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