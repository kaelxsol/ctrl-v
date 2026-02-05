// Background service worker for CTRL + V

console.log('[CTRL + V] Background service worker started');

// Import update checker
importScripts('utils/updateChecker.js');

// State management
let currentTokenData = null;
let walletConnection = null;

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type);

  switch (message.type) {
    case 'CLONE_TOKEN':
      handleCloneToken(message.payload, sendResponse);
      return true; // Keep channel open for async

    case 'GET_CURRENT_TOKEN':
      sendResponse({ success: true, data: currentTokenData });
      break;

    case 'SET_TOKEN_DATA':
      currentTokenData = message.payload;
      sendResponse({ success: true });
      break;

    case 'CONNECT_WALLET':
      handleWalletConnect(message.payload, sendResponse);
      return true;

    case 'LAUNCH_TOKEN':
      handleLaunchToken(message.payload, sendResponse);
      return true;

    case 'FETCH_PROXY':
      // Handle fetch requests from content script (bypasses CORS in service worker)
      handleFetchProxy(message.url, message.options, sendResponse);
      return true;

    case 'CHECK_FOR_UPDATES':
      UpdateChecker.checkForUpdates().then(info => sendResponse({ success: true, data: info }));
      return true;

    case 'GET_UPDATE_INFO':
      UpdateChecker.getUpdateInfo().then(info => sendResponse({ success: true, data: info }));
      return true;

    case 'DISMISS_UPDATE':
      UpdateChecker.dismissUpdate(message.version).then(() => sendResponse({ success: true }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

/**
 * Handle clone token request
 */
async function handleCloneToken(tokenData, sendResponse) {
  try {
    console.log('[Background] Processing clone request:', tokenData);
    
    // Store the token data
    currentTokenData = tokenData;

    // Save to storage for persistence
    await chrome.storage.local.set({ 
      currentToken: tokenData,
      lastCloneRequest: Date.now()
    });

    // Open popup for user to configure and launch
    // Note: In MV3, we can't programmatically open popup, 
    // so we'll notify the user or use a different approach
    
    sendResponse({ 
      success: true, 
      message: 'Token data captured. Click the extension icon to launch.',
      data: tokenData 
    });

  } catch (error) {
    console.error('[Background] Clone token error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle fetch proxy requests from content script
 * Service worker can bypass CORS for URLs in host_permissions
 */
async function handleFetchProxy(url, options, sendResponse) {
  try {
    console.log('[Background] Fetch proxy request:', url);
    
    // Reconstruct fetch options
    let fetchOptions = { ...options };
    
    // Handle FormData reconstruction if needed
    if (options.bodyType === 'formdata' && options.formDataEntries) {
      const formData = new FormData();
      for (const entry of options.formDataEntries) {
        if (entry.isBlob) {
          // Reconstruct blob from base64
          const byteString = atob(entry.value.data);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: entry.value.type });
          formData.append(entry.key, blob, entry.value.name);
        } else {
          formData.append(entry.key, entry.value);
        }
      }
      fetchOptions.body = formData;
      delete fetchOptions.bodyType;
      delete fetchOptions.formDataEntries;
    }
    
    const response = await fetch(url, fetchOptions);
    
    // Determine response type and serialize accordingly
    const contentType = response.headers.get('content-type') || '';
    let responseData;
    let responseType;

    if (contentType.includes('application/json')) {
      responseData = await response.json();
      responseType = 'json';
    } else if (contentType.includes('image/') || options.responseType === 'blob') {
      // Handle image responses - convert to base64
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      responseData = { base64: btoa(binary), mimeType: contentType };
      responseType = 'blob';
    } else if (contentType.includes('application/octet-stream') || options.responseType === 'arraybuffer') {
      const arrayBuffer = await response.arrayBuffer();
      responseData = Array.from(new Uint8Array(arrayBuffer));
      responseType = 'arraybuffer';
    } else {
      responseData = await response.text();
      responseType = 'text';
    }
    
    sendResponse({
      success: true,
      ok: response.ok,
      status: response.status,
      responseType,
      data: responseData
    });
    
  } catch (error) {
    console.error('[Background] Fetch proxy error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

/**
 * Handle wallet connection
 */
async function handleWalletConnect(walletType, sendResponse) {
  try {
    // Store wallet preference
    await chrome.storage.local.set({ preferredWallet: walletType });
    
    // Actual wallet connection happens in popup context
    sendResponse({ success: true, walletType });

  } catch (error) {
    console.error('[Background] Wallet connect error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle token launch request
 */
async function handleLaunchToken(launchData, sendResponse) {
  try {
    console.log('[Background] Processing launch request:', launchData);

    const platform = launchData.platform || 'pump';

    // Validate required fields
    if (!launchData.name || !launchData.ticker) {
      throw new Error('Token name and ticker are required');
    }

    // Validate Bags API key
    if (platform === 'bags' && !launchData.apiKey) {
      throw new Error('Bags API key is required');
    }

    // Store launch attempt
    await chrome.storage.local.set({
      lastLaunchAttempt: {
        ...launchData,
        platform,
        timestamp: Date.now(),
        status: 'pending'
      }
    });

    // The actual launch would be handled by launcher.js utility
    // For now, return success to indicate the request was processed
    const platformNames = {
      pump: 'Pump.fun',
      bonk: 'Bonk.fun',
      bags: 'Bags.fm'
    };

    sendResponse({
      success: true,
      message: `${platformNames[platform]} launch initiated`,
      platform
    });

  } catch (error) {
    console.error('[Background] Launch token error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed:', details.reason);
  
  if (details.reason === 'install') {
    // First time install - initialize storage
    chrome.storage.local.set({
      launchHistory: [],
      settings: {
        defaultSlippage: 10,
        defaultBuyAmount: 0.1,
        autoFillEnabled: true
      }
    });
  }
  
  // Schedule update checks (runs on install and update)
  UpdateChecker.scheduleUpdateChecks();
});

/**
 * Handle tab updates - refresh token data when navigating
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('axiom.trade/meme/')) {
    // Request fresh token data from content script
    chrome.tabs.sendMessage(tabId, { type: 'GET_TOKEN_DATA' }, (response) => {
      if (response?.success && response.data) {
        currentTokenData = response.data;
        chrome.storage.local.set({ currentToken: response.data });
      }
    });
  }
});
