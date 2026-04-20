chrome.runtime.onInstalled.addListener(() => {
    console.log("Misinformation Detector installed!");

    // Create Context Menu
    chrome.contextMenus.create({
        id: "verify-selection",
        title: "Verify Selection",
        contexts: ["selection"]
    });
});

chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// Handle Context Menu Click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "verify-selection" && info.selectionText) {
        // 1. Open Side Panel
        await chrome.sidePanel.open({ tabId: tab.id });

        // 2. Wait for it to load (short delay) then send text
        setTimeout(() => {
            chrome.runtime.sendMessage({
                action: "analyzeSelection",
                text: info.selectionText
            });
        }, 500);
    }
});     