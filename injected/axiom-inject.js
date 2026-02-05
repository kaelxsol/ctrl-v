// Injected script for CTRL + V
// This script runs in the page context to access page variables

(function() {
  'use strict';

  console.log('[Axiom Inject] Script loaded in page context');

  /**
   * Attempt to extract data from React fiber/state
   * This is an advanced technique that may break with Axiom updates
   */
  function extractFromReact() {
    const data = {};

    try {
      // Look for React root
      const root = document.getElementById('__next') || document.getElementById('root');
      if (!root) return data;

      // Try to find React fiber
      const fiberKey = Object.keys(root).find(key => 
        key.startsWith('__reactFiber$') || 
        key.startsWith('__reactInternalInstance$')
      );

      if (fiberKey) {
        const fiber = root[fiberKey];
        // Traverse fiber tree to find token data
        // This is framework-specific and may need adjustment
        console.log('[Axiom Inject] React fiber found');
      }

    } catch (err) {
      console.warn('[Axiom Inject] React extraction failed:', err);
    }

    return data;
  }

  /**
   * Extract data from global window variables
   */
  function extractFromGlobals() {
    const data = {};

    try {
      // Check for __NEXT_DATA__ (Next.js)
      if (window.__NEXT_DATA__?.props?.pageProps) {
        const pageProps = window.__NEXT_DATA__.props.pageProps;
        Object.assign(data, {
          tokenData: pageProps.tokenData,
          pairData: pageProps.pairData
        });
      }

      // Check for other common patterns
      if (window.__PRELOADED_STATE__) {
        data.preloadedState = window.__PRELOADED_STATE__;
      }

    } catch (err) {
      console.warn('[Axiom Inject] Global extraction failed:', err);
    }

    return data;
  }

  /**
   * Intercept network requests for token data
   */
  function setupNetworkInterception() {
    const originalFetch = window.fetch;
    
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      
      // Clone response to read it
      const clone = response.clone();
      const url = args[0]?.toString() || '';

      try {
        // Intercept Axiom API calls
        if (url.includes('pair-info') || url.includes('token-info')) {
          const data = await clone.json();
          
          // Post message to content script
          window.postMessage({
            type: 'AXIOM_API_DATA',
            endpoint: url,
            data
          }, '*');
        }
      } catch (err) {
        // Response might not be JSON, ignore
      }

      return response;
    };

    console.log('[Axiom Inject] Network interception set up');
  }

  /**
   * Send extracted data to content script
   */
  function sendToContentScript(data) {
    window.postMessage({
      type: 'AXIOM_INJECTED_DATA',
      data
    }, '*');
  }

  /**
   * Initialize the injected script
   */
  function init() {
    // Set up network interception
    setupNetworkInterception();

    // Initial extraction
    const reactData = extractFromReact();
    const globalData = extractFromGlobals();

    if (Object.keys(reactData).length > 0 || Object.keys(globalData).length > 0) {
      sendToContentScript({
        ...reactData,
        ...globalData
      });
    }

    // Listen for requests from content script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;

      if (event.data.type === 'REQUEST_AXIOM_DATA') {
        const data = {
          react: extractFromReact(),
          globals: extractFromGlobals()
        };
        sendToContentScript(data);
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
