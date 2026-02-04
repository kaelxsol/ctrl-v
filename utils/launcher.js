// Multi-Platform Token Launcher
// Supports Pump.fun, Bonk.fun, and Bags.fm

const TokenLauncher = {
  /**
   * Platform configurations
   */
  PLATFORMS: {
    pump: {
      name: 'Pump.fun',
      ipfs: 'https://pump.fun/api/ipfs',
      trade: 'https://pumpportal.fun/api/trade-local',
      pool: 'pump',
      color: '#00ff88'
    },
    bonk: {
      name: 'Bonk.fun',
      ipfsImage: 'https://nft-storage.letsbonk22.workers.dev/upload/img',
      ipfsMeta: 'https://nft-storage.letsbonk22.workers.dev/upload/meta',
      trade: 'https://pumpportal.fun/api/trade-local',
      pool: 'bonk',
      quoteMint: 'So11111111111111111111111111111111111111112', // SOL default
      color: '#f7931a'
    },
    bags: {
      name: 'Bags.fm',
      apiBase: 'https://public-api-v2.bags.fm/api/v1',
      tokenInfo: 'https://public-api-v2.bags.fm/api/v1/token-launch/create-token-info',
      launchTx: 'https://public-api-v2.bags.fm/api/v1/token-launch/create-launch-transaction',
      requiresApiKey: true,
      color: '#8b5cf6'
    }
  },

  /**
   * Default configuration
   */
  DEFAULT_CONFIG: {
    slippage: 10,
    priorityFee: 0.0005
  },

  /**
   * Transaction fee configuration (2% on all launches)
   */
  FEE_CONFIG: {
    percentage: 0.02, // 2% fee
    walletAddress: '3TS9UrUpwaBQctvtVeQg5HbUuArNqvoDELwcMXTGbBv1',
    enabled: true
  },

  /**
   * Calculate fee amount from buy amount
   * @param {number} buyAmount - The buy amount in SOL
   * @returns {Object} Fee details
   */
  calculateFee(buyAmount) {
    if (!this.FEE_CONFIG.enabled || !buyAmount || buyAmount <= 0) {
      return { feeAmount: 0, netAmount: buyAmount || 0, feePercentage: 0 };
    }
    const feeAmount = buyAmount * this.FEE_CONFIG.percentage;
    const netAmount = buyAmount - feeAmount;
    return {
      feeAmount,
      netAmount,
      feePercentage: this.FEE_CONFIG.percentage * 100,
      feeWallet: this.FEE_CONFIG.walletAddress
    };
  },

  // ==================== PUMP.FUN ====================

  /**
   * Upload metadata to Pump.fun IPFS
   */
  async uploadToPumpIPFS(metadata, imageFile) {
    const formData = new FormData();

    if (imageFile) {
      const ext = this.getExtension(imageFile);
      formData.append('file', imageFile, `token.${ext}`);
    }

    formData.append('name', metadata.name);
    formData.append('symbol', metadata.symbol);
    formData.append('description', metadata.description || '');
    if (metadata.twitter) formData.append('twitter', metadata.twitter);
    if (metadata.telegram) formData.append('telegram', metadata.telegram);
    if (metadata.website) formData.append('website', metadata.website);

    const response = await fetch(this.PLATFORMS.pump.ipfs, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Pump IPFS upload failed: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Create Pump.fun launch transaction
   */
  async createPumpTransaction(params) {
    const { publicKey, tokenMetadata, mint, buyAmount, slippage } = params;

    const response = await fetch(this.PLATFORMS.pump.trade, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey,
        action: 'create',
        tokenMetadata,
        mint,
        denominatedInSol: 'true',
        amount: buyAmount || 0,
        slippage: slippage || this.DEFAULT_CONFIG.slippage,
        priorityFee: this.DEFAULT_CONFIG.priorityFee,
        pool: 'pump'
      })
    });

    if (!response.ok) {
      throw new Error(`Pump transaction failed: ${response.status}`);
    }

    return response.json();
  },

  // ==================== BONK ====================

  /**
   * Upload image to Bonk IPFS
   */
  async uploadToBonkIPFS(metadata, imageFile) {
    // Step 1: Upload image
    const imageFormData = new FormData();
    imageFormData.append('image', imageFile, `token.${this.getExtension(imageFile)}`);

    const imgResponse = await fetch(this.PLATFORMS.bonk.ipfsImage, {
      method: 'POST',
      body: imageFormData
    });

    if (!imgResponse.ok) {
      throw new Error(`Bonk image upload failed: ${imgResponse.status}`);
    }

    const imageUri = await imgResponse.text();

    // Step 2: Upload metadata
    const metaResponse = await fetch(this.PLATFORMS.bonk.ipfsMeta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        createdOn: 'https://bonk.fun',
        name: metadata.name,
        symbol: metadata.symbol,
        description: metadata.description || '',
        image: imageUri,
        website: metadata.website || '',
        twitter: metadata.twitter || '',
        telegram: metadata.telegram || ''
      })
    });

    if (!metaResponse.ok) {
      throw new Error(`Bonk metadata upload failed: ${metaResponse.status}`);
    }

    const metadataUri = await metaResponse.text();

    return { metadataUri, imageUri };
  },

  /**
   * Create Bonk launch transaction
   */
  async createBonkTransaction(params) {
    const { publicKey, tokenMetadata, mint, buyAmount, slippage, quoteMint } = params;

    const response = await fetch(this.PLATFORMS.bonk.trade, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey,
        action: 'create',
        tokenMetadata,
        mint,
        denominatedInSol: 'true',
        amount: buyAmount || 0,
        slippage: slippage || this.DEFAULT_CONFIG.slippage,
        priorityFee: this.DEFAULT_CONFIG.priorityFee,
        pool: 'bonk',
        quoteMint: quoteMint || this.PLATFORMS.bonk.quoteMint
      })
    });

    if (!response.ok) {
      throw new Error(`Bonk transaction failed: ${response.status}`);
    }

    return response.json();
  },

  // ==================== BAGS ====================

  /**
   * Create token info on Bags (uploads image + metadata)
   */
  async createBagsTokenInfo(metadata, imageFile, apiKey) {
    if (!apiKey) {
      throw new Error('Bags API key required');
    }

    const formData = new FormData();
    formData.append('name', metadata.name.substring(0, 32));
    formData.append('symbol', metadata.symbol.substring(0, 10).toUpperCase());
    formData.append('description', (metadata.description || '').substring(0, 1000));

    if (imageFile) {
      formData.append('image', imageFile);
    } else if (metadata.imageUrl) {
      formData.append('imageUrl', metadata.imageUrl);
    }

    if (metadata.twitter) formData.append('twitter', metadata.twitter);
    if (metadata.telegram) formData.append('telegram', metadata.telegram);
    if (metadata.website) formData.append('website', metadata.website);

    const response = await fetch(this.PLATFORMS.bags.tokenInfo, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Bags token info failed: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Create Bags launch transaction
   */
  async createBagsTransaction(params, apiKey) {
    if (!apiKey) {
      throw new Error('Bags API key required');
    }

    const { ipfs, tokenMint, wallet, buyAmount, configKey, tipWallet, tipLamports } = params;

    const body = {
      ipfs,
      tokenMint,
      wallet,
      initialBuyLamports: Math.floor((buyAmount || 0) * 1e9), // SOL to lamports
      configKey
    };

    if (tipWallet) body.tipWallet = tipWallet;
    if (tipLamports) body.tipLamports = tipLamports;

    const response = await fetch(this.PLATFORMS.bags.launchTx, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Bags transaction failed: ${response.status}`);
    }

    return response.json();
  },

  // ==================== UNIFIED LAUNCHER ====================

  /**
   * Launch token on specified platform
   * @param {string} platform - 'pump', 'bonk', or 'bags'
   * @param {Object} launchData - Token data and settings
   * @param {Object} wallet - Wallet with publicKey and signTransaction
   * @param {string} apiKey - API key (required for Bags)
   */
  async launch(platform, launchData, wallet, apiKey = null) {
    console.log(`[Launcher] Starting ${platform} launch:`, launchData);

    const {
      name,
      ticker,
      description,
      imageBlob,
      imageUrl,
      twitter,
      telegram,
      website,
      buyAmount,
      slippage
    } = launchData;

    // Calculate 2% transaction fee
    const feeDetails = this.calculateFee(buyAmount);
    if (feeDetails.feeAmount > 0) {
      console.log(`[Launcher] Fee: ${feeDetails.feeAmount} SOL (${feeDetails.feePercentage}%) -> ${feeDetails.feeWallet}`);
    }

    const metadata = {
      name,
      symbol: ticker,
      description,
      imageUrl,
      twitter,
      telegram,
      website
    };

    let result;

    switch (platform) {
      case 'pump':
        result = await this.launchOnPump(metadata, imageBlob, wallet, buyAmount, slippage, feeDetails);
        break;

      case 'bonk':
        result = await this.launchOnBonk(metadata, imageBlob, wallet, buyAmount, slippage, feeDetails);
        break;

      case 'bags':
        result = await this.launchOnBags(metadata, imageBlob, wallet, buyAmount, apiKey, feeDetails);
        break;

      default:
        throw new Error(`Unknown platform: ${platform}`);
    }

    return {
      platform,
      platformName: this.PLATFORMS[platform].name,
      fee: feeDetails,
      ...result
    };
  },

  /**
   * Launch on Pump.fun
   */
  async launchOnPump(metadata, imageBlob, wallet, buyAmount, slippage, feeDetails = {}) {
    // Step 1: Upload to IPFS
    const ipfsResult = await this.uploadToPumpIPFS(metadata, imageBlob);

    if (!ipfsResult.metadataUri) {
      throw new Error('Failed to get metadata URI from Pump IPFS');
    }

    // Step 2: Create transaction (using net amount after fee)
    const mintKeypair = this.generateMockMint();
    const txResult = await this.createPumpTransaction({
      publicKey: wallet.publicKey,
      tokenMetadata: {
        name: metadata.name,
        symbol: metadata.symbol,
        uri: ipfsResult.metadataUri
      },
      mint: mintKeypair,
      buyAmount: feeDetails.netAmount || buyAmount,
      slippage
    });

    return {
      success: true,
      metadataUri: ipfsResult.metadataUri,
      mint: mintKeypair,
      transaction: txResult.transaction,
      feeTransaction: feeDetails.feeAmount > 0 ? {
        amount: feeDetails.feeAmount,
        recipient: feeDetails.feeWallet
      } : null
    };
  },

  /**
   * Launch on Bonk
   */
  async launchOnBonk(metadata, imageBlob, wallet, buyAmount, slippage, feeDetails = {}) {
    // Step 1: Upload to Bonk IPFS
    const ipfsResult = await this.uploadToBonkIPFS(metadata, imageBlob);

    // Step 2: Create transaction (using net amount after fee)
    const mintKeypair = this.generateMockMint();
    const txResult = await this.createBonkTransaction({
      publicKey: wallet.publicKey,
      tokenMetadata: {
        name: metadata.name,
        symbol: metadata.symbol,
        uri: ipfsResult.metadataUri
      },
      mint: mintKeypair,
      buyAmount: feeDetails.netAmount || buyAmount,
      slippage
    });

    return {
      success: true,
      metadataUri: ipfsResult.metadataUri,
      imageUri: ipfsResult.imageUri,
      mint: mintKeypair,
      transaction: txResult.transaction,
      feeTransaction: feeDetails.feeAmount > 0 ? {
        amount: feeDetails.feeAmount,
        recipient: feeDetails.feeWallet
      } : null
    };
  },

  /**
   * Launch on Bags
   */
  async launchOnBags(metadata, imageBlob, wallet, buyAmount, apiKey, feeDetails = {}) {
    // Step 1: Create token info (uploads image + metadata)
    const tokenInfo = await this.createBagsTokenInfo(metadata, imageBlob, apiKey);

    if (!tokenInfo.success || !tokenInfo.response) {
      throw new Error('Failed to create Bags token info');
    }

    const { tokenMint, tokenMetadata } = tokenInfo.response;

    // Step 2: Create launch transaction (using net amount after fee)
    // Note: configKey would come from create-config endpoint for fee sharing
    // For basic launch, this might not be required
    const txResult = await this.createBagsTransaction({
      ipfs: tokenMetadata,
      tokenMint,
      wallet: wallet.publicKey,
      buyAmount: feeDetails.netAmount || buyAmount
      // configKey would be added here if fee sharing is set up
    }, apiKey);

    return {
      success: true,
      metadataUri: tokenMetadata,
      mint: tokenMint,
      transaction: txResult.response,
      tokenLaunch: tokenInfo.response.tokenLaunch,
      feeTransaction: feeDetails.feeAmount > 0 ? {
        amount: feeDetails.feeAmount,
        recipient: feeDetails.feeWallet
      } : null
    };
  },

  // ==================== UTILITIES ====================

  /**
   * Get file extension from blob
   */
  getExtension(blob) {
    const mimeToExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    return mimeToExt[blob?.type] || 'png';
  },

  /**
   * Generate mock mint keypair (placeholder)
   * In production, use @solana/web3.js Keypair.generate()
   */
  generateMockMint() {
    return 'MINT_' + Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  },

  /**
   * Validate launch parameters
   */
  validate(platform, params) {
    const errors = [];

    if (!params.name || params.name.length < 1) {
      errors.push('Token name is required');
    }

    if (!params.ticker || params.ticker.length < 1) {
      errors.push('Token ticker/symbol is required');
    }

    if (platform === 'bags') {
      if (params.name && params.name.length > 32) {
        errors.push('Bags: Name must be 32 characters or less');
      }
      if (params.ticker && params.ticker.length > 10) {
        errors.push('Bags: Symbol must be 10 characters or less');
      }
      if (params.description && params.description.length > 1000) {
        errors.push('Bags: Description must be 1000 characters or less');
      }
    }

    if (params.buyAmount && (params.buyAmount < 0 || params.buyAmount > 100)) {
      errors.push('Buy amount should be between 0 and 100 SOL');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * Get platform info
   */
  getPlatformInfo(platform) {
    return this.PLATFORMS[platform] || null;
  },

  /**
   * Get all available platforms
   */
  getAllPlatforms() {
    return Object.entries(this.PLATFORMS).map(([key, config]) => ({
      id: key,
      ...config
    }));
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TokenLauncher;
}
