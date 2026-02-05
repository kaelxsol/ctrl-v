// Content script for CTRL-V
// Injected into axiom.trade pages

(function() {
  'use strict';

  console.log('[CTRL-V] Content script loaded');

  // Configuration
  const CONFIG = {
    observerDebounce: 500,
  };

  // State
  let observer = null;
  let debounceTimer = null;
  let panelInjected = false;

  /**
   * Inject the draggable panel CSS and JS
   */
  function injectPanel() {
    if (panelInjected) return;
    panelInjected = true;

    console.log('[CTRL-V] Injecting panel...');

    // Inject CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('injected/panel.css');
    document.head.appendChild(link);
    console.log('[CTRL-V] CSS injected:', link.href);

    // Inject JS with extension URLs as data attributes
    // We use data attributes instead of inline scripts to avoid CSP blocking
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected/panel.js');
    script.dataset.extensionId = chrome.runtime.id;
    script.dataset.solanaWeb3Url = chrome.runtime.getURL('vendor/solana-web3.min.js');
    script.onload = () => {
      console.log('[CTRL-V] Panel JS loaded successfully');
      // Don't remove the script - we need to read data attributes from it
    };
    script.onerror = (e) => {
      console.error('[CTRL-V] Panel JS failed to load:', e);
    };
    document.head.appendChild(script);

    console.log('[CTRL-V] Panel injection initiated');
  }

  /**
   * Extract contract address from current URL
   */
  function getContractFromURL() {
    const match = window.location.pathname.match(/\/meme\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Handle clone trigger - opens draggable panel
   */
  function handleCloneClick(tokenData) {
    console.log('[CTRL-V] Clone clicked:', tokenData);

    // Ensure panel is injected
    injectPanel();

    // Store token data
    chrome.storage.local.set({ currentToken: tokenData });

    // Send message to panel via window.postMessage (for page context)
    window.postMessage({ type: 'ACL_SHOW_PANEL', tokenData }, '*');

    // Also notify background
    chrome.runtime.sendMessage({
      type: 'CLONE_TOKEN',
      payload: tokenData
    });
  }

  /**
   * Extract token data from the page
   */
  function extractTokenData() {
    const contractAddress = getContractFromURL();
    if (!contractAddress) return null;

    const data = {
      contractAddress,
      name: '',
      ticker: '',
      description: '',
      imageUrl: '',
      twitter: '',
      telegram: '',
      website: '',
      extractedAt: Date.now()
    };

    // Try to find the actual token image from the page DOM
    // Axiom uses UUIDs for some images, not contract addresses
    const tokenImg = document.querySelector(
      'div[class*="rounded-full"] img[src*="digitaloceanspaces"], ' +
      'div[class*="overflow-hidden rounded"] img[src*="digitaloceanspaces"], ' +
      'img[src*="axiomtrading.sfo3"][class*="rounded"], ' +
      `img[src*="${contractAddress}"]`
    );

    if (tokenImg?.src && tokenImg.src.includes('digitaloceanspaces')) {
      data.imageUrl = tokenImg.src;
    } else {
      // Fallback to constructed URL
      data.imageUrl = `https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/${contractAddress}.webp`;
    }

    try {
      // Axiom uses truncate divs for token info
      const truncateDivs = document.querySelectorAll('div[class*="truncate"]');

      // Ticker: 14px font size truncate div (usually first meaningful one)
      const tickerEl = document.querySelector('div.text-\\[14px\\][class*="truncate"]');
      if (tickerEl) {
        data.ticker = tickerEl.textContent.trim().replace(/^\$/, '');
      }

      // Name: Find truncate div with reasonable text length (not ticker, not numbers)
      for (const div of truncateDivs) {
        const text = div.textContent.trim();
        if (text.length > 1 && text.length < 50 &&
            text !== data.ticker &&
            !/^[\d$%.,]+$/.test(text) &&
            !text.includes('Search')) {
          data.name = text;
          break;
        }
      }

      // Fallback: If name empty but ticker found, use ticker as name
      if (!data.name && data.ticker) {
        data.name = data.ticker;
      }

      // Description - try common patterns
      const descEl = document.querySelector('[class*="description"], [class*="bio"], [class*="about"]');
      if (descEl) data.description = descEl.textContent.trim();

      // Social links
      document.querySelectorAll('a[href]').forEach(link => {
        const href = link.href.toLowerCase();
        if ((href.includes('x.com') || href.includes('twitter.com')) &&
            !href.includes('search?q=') && !data.twitter) {
          data.twitter = link.href;
        } else if ((href.includes('t.me') || href.includes('telegram')) && !data.telegram) {
          data.telegram = link.href;
        }
      });

      // Website link (non-social external link)
      document.querySelectorAll('a[target="_blank"]').forEach(link => {
        const href = link.href;
        if (!href.includes('twitter') && !href.includes('x.com') &&
            !href.includes('telegram') && !href.includes('t.me') &&
            !href.includes('axiom.trade') && !href.includes('solscan') &&
            !href.includes('dexscreener') && !data.website) {
          data.website = href;
        }
      });

    } catch (err) {
      console.warn('[CTRL-V] DOM extraction error:', err);
    }

    return data;
  }

  /**
   * Set up mutation observer for dynamic content
   * (Currently unused but kept for future enhancements)
   */
  function setupObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      // Debounce to avoid excessive processing
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Future: could be used for dynamic content detection
      }, CONFIG.observerDebounce);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Setup Ctrl+Click, Alt+Click, and Alt+Shift+Click handlers for token cards/rows
   * Ctrl+Click: Clone token (copy metadata)
   * Alt+Click: Generate opposite token (AI-powered)
   * Alt+Shift+Click: Generate beta play (AI-powered creative derivative)
   * Works on Pulse page (pump.fun links) and token pages (/meme/ links)
   */
  function setupCopyButtonHandler() {
    document.addEventListener('click', (e) => {
      // Only trigger on Ctrl+Click or Alt+Click (with or without Shift)
      if (!e.ctrlKey && !e.altKey) return;

      const isAltClick = e.altKey && !e.ctrlKey && !e.shiftKey;
      const isBetaPlayClick = e.altKey && e.shiftKey && !e.ctrlKey;

      // Find the token card - look for cursor-pointer elements or card-like containers
      let card = e.target.closest('[class*="cursor-pointer"][class*="border"], [class*="token-card"], [class*="token-row"]');

      // Also check if clicking on copy icon specifically
      const copyIcon = e.target.closest('i.ri-file-copy-line, i[class*="ri-file-copy"]');

      // Walk up to find a container with token links
      let container = copyIcon || card || e.target;
      let contractAddress = null;

      // Solana address pattern: base58, 32-44 chars
      const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

      for (let i = 0; i < 15 && container; i++) {
        // Check for /meme/ link (Axiom token pages)
        const memeLink = container.querySelector('a[href*="/meme/"]');
        if (memeLink) {
          const match = memeLink.href.match(/\/meme\/([A-Za-z0-9]+)/);
          if (match) {
            contractAddress = match[1];
            console.log('[ACL] Found /meme/ CA at depth', i, contractAddress);
            break;
          }
        }

        // Check for pump.fun link
        const pumpLink = container.querySelector('a[href*="pump.fun/coin/"]');
        if (pumpLink) {
          const match = pumpLink.href.match(/pump\.fun\/coin\/([A-Za-z0-9]+)/);
          if (match) {
            contractAddress = match[1];
            console.log('[ACL] Found pump.fun CA at depth', i, contractAddress);
            break;
          }
        }

        // Check for Raydium link
        const raydiumLink = container.querySelector('a[href*="raydium.io"]');
        if (raydiumLink) {
          const match = raydiumLink.href.match(solanaAddressRegex);
          if (match) {
            contractAddress = match[0];
            console.log('[ACL] Found Raydium CA at depth', i, contractAddress);
            break;
          }
        }

        // Check for dexscreener link
        const dexLink = container.querySelector('a[href*="dexscreener.com/solana/"]');
        if (dexLink) {
          const match = dexLink.href.match(/solana\/([A-Za-z0-9]+)/);
          if (match) {
            contractAddress = match[1];
            console.log('[ACL] Found dexscreener CA at depth', i, contractAddress);
            break;
          }
        }

        // Fallback: Look for any link containing a Solana address
        const allLinks = container.querySelectorAll('a[href]');
        for (const link of allLinks) {
          const match = link.href.match(solanaAddressRegex);
          if (match && match[0].length >= 32) {
            contractAddress = match[0];
            console.log('[ACL] Found CA in link at depth', i, contractAddress);
            break;
          }
        }
        if (contractAddress) break;

        container = container.parentElement;
      }

      if (!contractAddress) {
        // Not on a token card, let normal click happen
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      console.log('[ACL] Ctrl+Click on token card, CA:', contractAddress);

      // Build token data
      const tokenData = {
        contractAddress,
        name: '',
        ticker: '',
        description: '',
        imageUrl: `https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/${contractAddress}.webp`,
        twitter: '',
        telegram: '',
        website: '',
        extractedAt: Date.now()
      };

      // Try to extract name/ticker from the container
      try {
        // Look for token image (68x68 rounded image on Pulse, or CDN image)
        const tokenImg = container.querySelector('img[class*="rounded"][class*="object-cover"], img[src*="cdn.digitalocean"], img[src*="cf-ipfs"]');
        if (tokenImg?.src && !tokenImg.src.includes('svg')) {
          tokenData.imageUrl = tokenImg.src;
        }

        // Strategy 1: Find TICKER - it's in a truncate div with text-textPrimary and max-width style
        // Example: <div class="truncate text-[16px] font-medium text-textPrimary" style="max-width: calc(120px);">TICKER</div>
        const tickerEl = container.querySelector('div[class*="text-textPrimary"][class*="truncate"][class*="font-medium"]');
        if (tickerEl) {
          const text = tickerEl.textContent?.trim();
          if (text && text.length >= 1 && text.length <= 20 && !/^[\d$%.,KMB\s]+$/.test(text)) {
            tokenData.ticker = text.replace(/^\$/, '');
            console.log('[ACL] Found ticker from textPrimary:', tokenData.ticker);
          }
        }

        // Strategy 2: Find NAME - it's in a span with cursor-pointer containing a div with copy icon nearby
        // Example: <span class="cursor-pointer text-textTertiary"><div class="truncate">NAME</div><i class="ri-file-copy-line"></i></span>
        const nameSpan = container.querySelector('span[class*="cursor-pointer"] div[class*="truncate"]');
        if (nameSpan) {
          const text = nameSpan.textContent?.trim();
          if (text && text.length >= 1 && text.length <= 50 && !/^[\d$%.,KMB\s]+$/.test(text)) {
            tokenData.name = text;
            console.log('[ACL] Found name from cursor-pointer span:', tokenData.name);
          }
        }

        // Strategy 3: Fallback - look for $TICKER pattern
        if (!tokenData.ticker) {
          const allElements = container.querySelectorAll('span, div, p');
          for (const el of allElements) {
            const text = el.textContent?.trim();
            if (text?.startsWith('$') && text.length >= 2 && text.length <= 12 &&
                !/[\d.,KMB%]/.test(text)) {
              tokenData.ticker = text.replace(/^\$/, '');
              console.log('[ACL] Found $ticker:', tokenData.ticker);
              break;
            }
          }
        }

        // Strategy 4: Fallback - look in truncate divs
        if (!tokenData.name || !tokenData.ticker) {
          const truncates = container.querySelectorAll('[class*="truncate"]');
          for (const el of truncates) {
            const text = el.textContent?.trim();
            if (text && text.length >= 1 && text.length <= 50 &&
                !/^[\d$%.,KMB\s]+$/.test(text) &&
                !text.includes('Search') &&
                !text.includes('SOL') &&
                text !== 'MC') {
              if (text.startsWith('$')) {
                if (!tokenData.ticker) {
                  tokenData.ticker = text.replace(/^\$/, '');
                }
              } else {
                if (!tokenData.name) {
                  tokenData.name = text;
                }
                if (!tokenData.ticker) {
                  tokenData.ticker = text;
                }
              }
              if (tokenData.name && tokenData.ticker) break;
            }
          }
        }

        // Final fallbacks
        if (!tokenData.name && tokenData.ticker) {
          tokenData.name = tokenData.ticker;
        }
        if (!tokenData.ticker && tokenData.name) {
          tokenData.ticker = tokenData.name;
        }

        console.log('[ACL] Final extracted - Name:', tokenData.name, 'Ticker:', tokenData.ticker);

      } catch (err) {
        console.warn('[ACL] Extraction error:', err);
      }

      if (isBetaPlayClick) {
        console.log('[ACL] Alt+Shift+Click beta play triggered:', tokenData);
        injectPanel();
        chrome.storage.local.set({ currentToken: tokenData });
        window.postMessage({ type: 'ACL_GENERATE_BETA_PLAY', tokenData }, '*');
      } else if (isAltClick) {
        console.log('[ACL] Alt+Click opposite triggered:', tokenData);
        injectPanel();
        chrome.storage.local.set({ currentToken: tokenData });
        window.postMessage({ type: 'ACL_GENERATE_OPPOSITE', tokenData }, '*');
      } else {
        console.log('[ACL] Ctrl+Click clone triggered:', tokenData);
        handleCloneClick(tokenData);
      }

    }, true); // Use capture phase

    console.log('[ACL] Ctrl+Click/Alt+Click/Alt+Shift+Click handlers installed');
  }

  /**
   * Initialize the content script
   */
  function init() {
    console.log('[CTRL-V] Initializing...');

    // Inject the draggable panel
    injectPanel();

    // Setup Ctrl+Click and Alt+Click handlers
    setupCopyButtonHandler();

    // Watch for dynamic content
    setupObserver();

    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_TOKEN_DATA') {
        const data = extractTokenData();
        sendResponse({ success: true, data });
      } else if (message.type === 'SHOW_PANEL') {
        window.postMessage({ type: 'ACL_SHOW_PANEL', tokenData: message.tokenData }, '*');
        sendResponse({ success: true });
      } else if (message.type === 'TOGGLE_PANEL') {
        window.postMessage({ type: 'ACL_TOGGLE_PANEL' }, '*');
        sendResponse({ success: true });
      }
      return true; // Keep channel open for async response
    });

    // Keyboard shortcut to toggle panel (Ctrl+Shift+C)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        window.postMessage({ type: 'ACL_TOGGLE_PANEL' }, '*');
      }
    });

    // Listen for messages from injected panel (page context)
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      const { type } = event.data || {};

      switch (type) {
        case 'ACL_REQUEST_DATA':
          // Panel requesting stored data
          chrome.storage.local.get(['currentToken', 'settings', 'burnerWallet', 'connectedWallet', 'selectedPlatform', 'bagsApiKey', 'autosignEnabled', 'importedWallet', 'rpcConfig', 'aiProvider', 'aiApiKey'], (result) => {
            window.postMessage({ type: 'ACL_DATA_RESPONSE', data: result }, '*');
          });
          break;

        case 'ACL_SAVE_DATA':
          // Panel saving data
          if (event.data.key) {
            chrome.storage.local.set({ [event.data.key]: event.data.value });
          }
          break;

        case 'ACL_LAUNCH_TOKEN':
          // Panel initiating launch
          chrome.runtime.sendMessage({
            type: 'LAUNCH_TOKEN',
            payload: event.data.payload
          }, (response) => {
            window.postMessage({
              type: 'ACL_LAUNCH_RESPONSE',
              success: response?.success,
              error: response?.error
            }, '*');
          });
          break;

        case 'ACL_REQUEST_EXTRACT':
          // Panel requesting token extraction from current page
          const tokenData = extractTokenData();
          if (tokenData && tokenData.contractAddress) {
            chrome.storage.local.set({ currentToken: tokenData });
            window.postMessage({ type: 'ACL_SHOW_PANEL', tokenData }, '*');
          }
          break;

        case 'ACL_FETCH_PROXY':
          // Panel requesting fetch through background script to bypass CORS
          (async () => {
            const { requestId, url, options } = event.data;
            try {
              // Forward to background script which can bypass CORS
              const response = await chrome.runtime.sendMessage({
                type: 'FETCH_PROXY',
                url,
                options
              });
              
              if (response.success) {
                window.postMessage({
                  type: 'ACL_FETCH_RESPONSE',
                  requestId,
                  success: true,
                  ok: response.ok,
                  status: response.status,
                  responseType: response.responseType,
                  data: response.data
                }, '*');
              } else {
                window.postMessage({
                  type: 'ACL_FETCH_RESPONSE',
                  requestId,
                  success: false,
                  error: response.error
                }, '*');
              }
            } catch (error) {
              window.postMessage({
                type: 'ACL_FETCH_RESPONSE',
                requestId,
                success: false,
                error: error.message
              }, '*');
            }
          })();
          break;
      }
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
