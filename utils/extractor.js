// Token Data Extractor Utility
// Handles extraction from Axiom.trade DOM and API

const TokenExtractor = {
  /**
   * Axiom CDN base URL for token images
   */
  CDN_BASE: 'https://axiomtrading.sfo3.cdn.digitaloceanspaces.com',

  /**
   * Axiom API base URL
   */
  API_BASE: 'https://axiom.trade/api',

  /**
   * Extract contract address from URL
   * @param {string} url - The page URL
   * @returns {string|null} Contract address or null
   */
  getContractFromURL(url = window.location.href) {
    const match = url.match(/\/meme\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  },

  /**
   * Build image URL for a token
   * @param {string} contractAddress 
   * @returns {string}
   */
  getImageURL(contractAddress) {
    return `${this.CDN_BASE}/${contractAddress}.webp`;
  },

  /**
   * Extract token data from the page DOM
   * @returns {Object} Extracted token data
   */
  extractFromDOM() {
    const contractAddress = this.getContractFromURL();
    
    const data = {
      contractAddress,
      name: '',
      ticker: '',
      description: '',
      imageUrl: contractAddress ? this.getImageURL(contractAddress) : '',
      twitter: '',
      telegram: '',
      website: '',
      source: 'dom',
      extractedAt: Date.now()
    };

    // Token name extraction strategies
    const nameSelectors = [
      '[data-testid="token-name"]',
      '[class*="token-name"]',
      '[class*="TokenName"]',
      'h1[class*="name"]',
      '.token-header h1',
      'h1'
    ];

    for (const selector of nameSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent) {
        data.name = el.textContent.trim();
        break;
      }
    }

    // Ticker extraction strategies
    const tickerSelectors = [
      '[data-testid="token-ticker"]',
      '[class*="ticker"]',
      '[class*="symbol"]',
      '[class*="TokenSymbol"]',
      '.token-ticker'
    ];

    for (const selector of tickerSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent) {
        data.ticker = el.textContent.trim().replace(/^\$/, '');
        break;
      }
    }

    // Description extraction
    const descSelectors = [
      '[class*="description"]',
      '[class*="bio"]',
      '[class*="about"]',
      '.token-description',
      'p[class*="desc"]'
    ];

    for (const selector of descSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent && el.textContent.length > 10) {
        data.description = el.textContent.trim();
        break;
      }
    }

    // Social links extraction
    const socialLinks = document.querySelectorAll('a[href]');
    socialLinks.forEach(link => {
      const href = link.href.toLowerCase();
      
      if ((href.includes('twitter.com') || href.includes('x.com')) && !data.twitter) {
        data.twitter = link.href;
      } else if ((href.includes('t.me') || href.includes('telegram')) && !data.telegram) {
        data.telegram = link.href;
      } else if (this.isWebsiteLink(href) && !data.website) {
        data.website = link.href;
      }
    });

    return data;
  },

  /**
   * Check if a URL is a valid website link (not social or known services)
   * @param {string} href 
   * @returns {boolean}
   */
  isWebsiteLink(href) {
    const excludePatterns = [
      'twitter.com', 'x.com',
      'telegram', 't.me',
      'discord',
      'axiom.trade',
      'solscan', 'solana',
      'dexscreener', 'dextools',
      'birdeye', 'pump.fun',
      'raydium', 'jupiter',
      'chrome-extension'
    ];

    return !excludePatterns.some(pattern => href.includes(pattern));
  },

  /**
   * Fetch token data from Axiom API
   * @param {string} contractAddress 
   * @returns {Promise<Object>}
   */
  async fetchFromAPI(contractAddress) {
    const data = {
      contractAddress,
      source: 'api',
      extractedAt: Date.now()
    };

    try {
      // Fetch pair info
      const pairResponse = await fetch(
        `${this.API_BASE}/pair-info?pairAddress=${contractAddress}`
      );
      
      if (pairResponse.ok) {
        const pairData = await pairResponse.json();
        Object.assign(data, this.normalizePairInfo(pairData));
      }

      // Fetch token info
      const tokenResponse = await fetch(
        `${this.API_BASE}/token-info?pairAddress=${contractAddress}`
      );
      
      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        Object.assign(data, this.normalizeTokenInfo(tokenData));
      }

    } catch (error) {
      console.error('[Extractor] API fetch error:', error);
      data.apiError = error.message;
    }

    return data;
  },

  /**
   * Normalize pair info response
   * @param {Object} pairData 
   * @returns {Object}
   */
  normalizePairInfo(pairData) {
    // Adjust based on actual Axiom API response structure
    return {
      pairAddress: pairData.pairAddress,
      liquidity: pairData.liquidity,
      volume24h: pairData.volume24h,
      priceUsd: pairData.priceUsd
    };
  },

  /**
   * Normalize token info response
   * @param {Object} tokenData 
   * @returns {Object}
   */
  normalizeTokenInfo(tokenData) {
    // Adjust based on actual Axiom API response structure
    return {
      name: tokenData.name || '',
      ticker: tokenData.symbol || '',
      description: tokenData.description || '',
      totalSupply: tokenData.totalSupply,
      holders: tokenData.holders,
      twitter: tokenData.twitter || tokenData.socials?.twitter || '',
      telegram: tokenData.telegram || tokenData.socials?.telegram || '',
      website: tokenData.website || tokenData.socials?.website || ''
    };
  },

  /**
   * Download token image from CDN
   * @param {string} imageUrl 
   * @returns {Promise<Blob>}
   */
  async downloadImage(imageUrl) {
    try {
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      const blob = await response.blob();
      
      // Validate image
      if (!blob.type.startsWith('image/')) {
        throw new Error('Downloaded content is not an image');
      }

      // Check size (Pump.fun limit is 15MB)
      if (blob.size > 15 * 1024 * 1024) {
        console.warn('[Extractor] Image exceeds 15MB, may need compression');
      }

      return blob;
    } catch (error) {
      console.error('[Extractor] Image download error:', error);
      throw error;
    }
  },

  /**
   * Convert image to specified format
   * @param {Blob} imageBlob 
   * @param {string} format - 'png' or 'jpeg'
   * @param {number} maxWidth 
   * @param {number} maxHeight 
   * @returns {Promise<Blob>}
   */
  async convertImage(imageBlob, format = 'png', maxWidth = 1000, maxHeight = 1000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(imageBlob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Calculate dimensions
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        // Draw to canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert image'));
            }
          },
          mimeType,
          0.9 // Quality for JPEG
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  },

  /**
   * Complete extraction - combines DOM and API data
   * @param {string} contractAddress 
   * @returns {Promise<Object>}
   */
  async extractComplete(contractAddress = null) {
    const address = contractAddress || this.getContractFromURL();
    
    if (!address) {
      throw new Error('No contract address found');
    }

    // Get DOM data first (faster)
    const domData = this.extractFromDOM();

    // Enhance with API data
    const apiData = await this.fetchFromAPI(address);

    // Merge, preferring API data over DOM when available
    return {
      ...domData,
      ...apiData,
      // Keep DOM data for fields API didn't provide
      name: apiData.name || domData.name,
      ticker: apiData.ticker || domData.ticker,
      description: apiData.description || domData.description,
      twitter: apiData.twitter || domData.twitter,
      telegram: apiData.telegram || domData.telegram,
      website: apiData.website || domData.website,
      imageUrl: domData.imageUrl
    };
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TokenExtractor;
}
