// ------------------- Grab & Clean Main Information -------------------
function grabMainInfoText() {
  // 1. Clone body to avoid modifying the actual page
  const clone = document.body.cloneNode(true);

  // 2. Remove known noise elements
  const noiseSelectors = [
    "nav", "header", "footer", "aside",
    ".nav", ".header", ".footer", ".sidebar", ".menu", ".ads", ".advertisement",
    "#nav", "#header", "#footer", "#sidebar",
    ".related", ".breadcrumbs", ".share-buttons", ".comments",
    "script", "style", "noscript", "iframe", "svg", "button", "input", "select", "textarea"
  ];

  noiseSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });

  // 3. Find the "densest" text block (likely the article)
  // Heuristic: The container with the most paragraph text is usually the main content
  const paragraphs = Array.from(clone.querySelectorAll('p'));
  let mainContainer = clone;

  // SPECIAL CASE: Wikipedia
  if (window.location.hostname.includes("wikipedia.org")) {
    const wikiContent = clone.querySelector("#bodyContent") || clone.querySelector("#mw-content-text");
    if (wikiContent) {
      mainContainer = wikiContent;
      mainContainer.querySelectorAll(".mw-editsection, .reference, .noprint, #catlinks, .mw-jump-link").forEach(e => e.remove());
    }
  }
  else if (paragraphs.length > 5) {
    const parentCounts = new Map();
    let maxCount = 0;
    let bestParent = null;

    paragraphs.forEach(p => {
      if (p.innerText.length < 50) return; // Ignore short captions
      let parent = p.parentElement;
      // Walk up to find a significant container (div, article, section)
      while (parent && parent !== clone && ['DIV', 'SECTION', 'ARTICLE', 'MAIN'].includes(parent.tagName)) {
        const current = parentCounts.get(parent) || 0;
        // Score based on text length
        const score = current + p.innerText.length;
        parentCounts.set(parent, score);

        if (score > maxCount) {
          maxCount = score;
          bestParent = parent;
        }
        parent = parent.parentElement;
      }
    });

    if (bestParent) mainContainer = bestParent;
  }

  // 4. Extract text from the identified winner
  let text = mainContainer.innerText;

  // 5. Aggressive regex cleanup
  text = text
    .split('\n')
    .map(line => line.trim())
    // Remove short lines (links, menu items, crumbs)
    .filter(line => line.length > 40 || line.endsWith('.'))
    // Remove navigation-like lines
    .filter(line => !/^(Home|Menu|Search|Login|Sign Up|Terms|Privacy|Copyright|©)/i.test(line))
    .join(' ');

  // Collapse multiple spaces
  text = text.replace(/\s{2,}/g, " ").trim();

  return text;
}

// ------------------- Selection Listener -------------------
document.addEventListener("mouseup", () => {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText.length > 5) {
    chrome.runtime.sendMessage({ type: "selection", text: selectedText });
  }
});

// ------------------- Highlight Misinformation -------------------
function highlightMisinformation(misinformationData) {
  const style = document.createElement("style");
  style.textContent = `
    .misinfo-highlight-red { background-color: rgba(239, 68, 68, 0.3); border-bottom: 2px solid #ef4444; cursor: help; }
    .misinfo-highlight-orange { background-color: rgba(245, 158, 11, 0.3); border-bottom: 2px solid #f59e0b; cursor: help; }
    .misinfo-highlight-yellow { background-color: rgba(255, 255, 0, 0.6); border-bottom: 2px solid #eab308; cursor: help; }
    .misinfo-highlight-green { background-color: rgba(34, 197, 94, 0.3); border-bottom: 2px solid #22c55e; cursor: help; }
  `;
  document.head.appendChild(style);

  // Helper: Escape regex special chars
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightGlobal(root, items) {
    // 1. Map all text nodes in the root
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let curr;
    while (curr = walker.nextNode()) {
      // Filter out empty or script/style nodes
      if (curr.matchParent && (curr.parentNode.tagName === 'SCRIPT' || curr.parentNode.tagName === 'STYLE')) continue;
      if (curr.textContent.trim().length > 0) textNodes.push(curr);
    }

    // 2. Build full text and location map
    // The map relates indices in 'fullText' to [node, nodeStartIndex]
    let fullText = "";
    const nodeMap = [];

    for (const node of textNodes) {
      nodeMap.push({
        node: node,
        start: fullText.length,
        length: node.textContent.length
      });
      fullText += node.textContent;
    }

    const matchesToHighlight = [];

    // 3. Find matches
    items.forEach(item => {
      if (!item.claim) {
        console.log('⚠️ Skipping item - no claim field:', item);
        return;
      }

      // Create flexible regex: replace spaces with \s+ to match newlines/multiple spaces
      const escapedClaim = escapeRegExp(item.claim.trim());
      // Allow flexible whitespace and case insensitive
      const pattern = escapedClaim.replace(/\s+/g, '\\s+');
      const regex = new RegExp(pattern, 'gi');

      let matchCount = 0;
      let match;
      while ((match = regex.exec(fullText)) !== null) {
        matchCount++;
        matchesToHighlight.push({
          start: match.index,
          end: match.index + match[0].length,
          score: item.harm_score,
          claim: item.claim // Keep reference for debugging
        });
      }

      if (matchCount === 0) {
        console.log('❌ NO MATCH FOUND for claim:', item.claim.substring(0, 100) + '...');
        console.log('   Verdict:', item.verdict, '| Harm Score:', item.harm_score);
      } else {
        console.log('✅ Found', matchCount, 'match(es) for:', item.claim.substring(0, 60) + '...');
      }
    });

    // 4. Highlight
    // Sort reverse to avoid index invalidation problems when wrapping
    matchesToHighlight.sort((a, b) => b.start - a.start);

    matchesToHighlight.forEach(match => {
      const { start, end, score } = match;

      // Determine class based on score
      let className = "misinfo-highlight-green";
      if (score >= 0.8) className = "misinfo-highlight-red";
      else if (score >= 0.6) className = "misinfo-highlight-orange";
      else if (score >= 0.3) className = "misinfo-highlight-yellow";

      // Find all text nodes involved in this match
      // A match might span multiple nodes (e.g. "Misinformation <b>is</b> bad")
      const involvedNodes = nodeMap.filter(n =>
        (n.start + n.length > start) && (n.start < end)
      );

      involvedNodes.forEach(n => {
        // Calculate slice for this specific node
        // The match relative to this node's content
        const nodeAbsStart = n.start;
        // Intersection of [nodeStart, nodeEnd] and [matchStart, matchEnd]
        const highlightStart = Math.max(nodeAbsStart, start);
        const highlightEnd = Math.min(nodeAbsStart + n.length, end);

        // Local offsets
        const localStart = highlightStart - nodeAbsStart;
        const localEnd = highlightEnd - nodeAbsStart;

        if (localEnd > localStart) {
          try {
            const span = document.createElement('span');
            span.className = className;
            span.title = "Click to see analysis in side panel";

            const range = document.createRange();
            range.setStart(n.node, localStart);
            range.setEnd(n.node, localEnd);
            range.surroundContents(span);
          } catch (e) {
            console.error("⚠️ DOM highlighting failed for:", match.claim?.substring(0, 50) + '...');
            console.error("   Error:", e.message);
            console.error("   Attempted class:", className);
          }
        }
      });
    });
  }

  // Highlight inside main/article/section/central div for precision
  let main = document.querySelector("main") || document.querySelector("article, section");
  if (!main) {
    let candidates = Array.from(document.body.querySelectorAll("div"))
      .filter(d => d.offsetWidth > 480 && d.offsetHeight > 220)
      .filter(d => !["NAV", "ASIDE", "FOOTER", "HEADER"].includes(d.parentElement?.tagName));
    candidates.sort((a, b) => b.offsetHeight * b.offsetWidth - a.offsetHeight * a.offsetWidth);
    main = candidates[0] || document.body;
  }

  // Use the global highlighter
  if (main) highlightGlobal(main, misinformationData);
}

// ------------------- Message Listener -------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "scanWebsite") {
    const text = grabMainInfoText();
    sendResponse({ text });
    return true;
  }
  if (msg.action === "fetchMainText") {
    const mainText = grabMainInfoText();
    sendResponse({ text: mainText });
    return true;
  }
  if (msg.action === "highlightMisinformation") {
    highlightMisinformation(msg.data);
    sendResponse({ status: "done" });
    return true;
  }
});
