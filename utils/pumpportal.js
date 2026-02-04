// PumpPortal API Integration Utility
// Handles token creation via Pump.fun's PumpPortal API

const PumpPortal = {
  /**
   * API Endpoints
   */
  ENDPOINTS: {
    IPFS: 'https://pump.fun/api/ipfs',
    TRADE: 'https://pumpportal.fun/api/trade-local'
  },

  /**
   * Default configuration
   */
  DEFAULT_CONFIG: {
    slippage: 10,
    priorityFee: 0.0005,
    pool: 'pump'
  },

  /**
   * Upload metadata and image to IPFS via Pump.fun
   * @param {Object} metadata - Token metadata
   * @param {File|Blob} imageFile - Token image
   * @returns {Promise<Object>} - IPFS upload response with metadataUri
   */
  async uploadToIPFS(metadata, imageFile) {
    console.log('[PumpPortal] Uploading to IPFS:', metadata);

    const formData = new FormData();
    
    // Add image file
    if (imageFile) {
      const fileName = `${metadata.symbol || 'token'}.${this.getExtension(imageFile)}`;
      formData.append('file', imageFile, fileName);
    }

    // Add metadata fields
    formData.append('name', metadata.name);
    formData.append('symbol', metadata.symbol || metadata.ticker);
    formData.append('description', metadata.description || '');

    // Optional social links
    if (metadata.twitter) {
      formData.append('twitter', metadata.twitter);
    }
    if (metadata.telegram) {
      formData.append('telegram', metadata.telegram);
    }
    if (metadata.website) {
      formData.append('website', metadata.website);
    }

    try {
      const response = await fetch(this.ENDPOINTS.IPFS, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`IPFS upload failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[PumpPortal] IPFS upload result:', result);

      return {
        success: true,
        metadataUri: result.metadataUri,
        imageUri: result.imageUri || result.metadataUri
      };

    } catch (error) {
      console.error('[PumpPortal] IPFS upload error:', error);
      throw error;
    }
  },

  /**
   * Create token launch transaction
   * @param {Object} params - Launch parameters
   * @returns {Promise<Object>} - Transaction data
   */
  async createLaunchTransaction(params) {
    console.log('[PumpPortal] Creating launch transaction:', params);

    const {
      publicKey,
      tokenMetadata,
      mint,
      buyAmount = 0,
      slippage = this.DEFAULT_CONFIG.slippage,
      priorityFee = this.DEFAULT_CONFIG.priorityFee,
      pool = this.DEFAULT_CONFIG.pool
    } = params;

    if (!publicKey) {
      throw new Error('Public key is required');
    }

    if (!tokenMetadata?.name || !tokenMetadata?.symbol) {
      throw new Error('Token metadata (name, symbol) is required');
    }

    const requestBody = {
      publicKey,
      action: 'create',
      tokenMetadata: {
        name: tokenMetadata.name,
        symbol: tokenMetadata.symbol,
        uri: tokenMetadata.uri || tokenMetadata.metadataUri
      },
      mint: mint || this.generateMintKeypair(),
      denominatedInSol: 'true',
      amount: buyAmount,
      slippage,
      priorityFee,
      pool
    };

    try {
      const response = await fetch(this.ENDPOINTS.TRADE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Transaction creation failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[PumpPortal] Transaction created:', result);

      return {
        success: true,
        transaction: result.transaction, // Base64 encoded
        mint: result.mint || mint
      };

    } catch (error) {
      console.error('[PumpPortal] Transaction creation error:', error);
      throw error;
    }
  },

  /**
   * Complete token launch flow
   * @param {Object} launchData - All launch data
   * @param {Object} wallet - Wallet interface (sign function)
   * @returns {Promise<Object>} - Launch result
   */
  async launchToken(launchData, wallet) {
    console.log('[PumpPortal] Starting token launch:', launchData);

    const {
      name,
      ticker,
      description,
      imageBlob,
      twitter,
      telegram,
      website,
      buyAmount,
      slippage
    } = launchData;

    // Step 1: Upload to IPFS
    console.log('[PumpPortal] Step 1: Uploading to IPFS...');
    const ipfsResult = await this.uploadToIPFS({
      name,
      symbol: ticker,
      description,
      twitter,
      telegram,
      website
    }, imageBlob);

    if (!ipfsResult.success || !ipfsResult.metadataUri) {
      throw new Error('Failed to upload metadata to IPFS');
    }

    // Step 2: Create launch transaction
    console.log('[PumpPortal] Step 2: Creating transaction...');
    const txResult = await this.createLaunchTransaction({
      publicKey: wallet.publicKey,
      tokenMetadata: {
        name,
        symbol: ticker,
        uri: ipfsResult.metadataUri
      },
      buyAmount,
      slippage
    });

    if (!txResult.success || !txResult.transaction) {
      throw new Error('Failed to create launch transaction');
    }

    // Step 3: Sign and send transaction
    console.log('[PumpPortal] Step 3: Signing transaction...');
    const signedTx = await wallet.signTransaction(txResult.transaction);

    // Step 4: Send to network
    console.log('[PumpPortal] Step 4: Broadcasting transaction...');
    const sendResult = await this.sendTransaction(signedTx);

    return {
      success: true,
      signature: sendResult.signature,
      mint: txResult.mint,
      metadataUri: ipfsResult.metadataUri,
      explorerUrl: `https://solscan.io/tx/${sendResult.signature}`
    };
  },

  /**
   * Send signed transaction to Solana network
   * @param {string} signedTransaction - Base64 encoded signed transaction
   * @returns {Promise<Object>}
   */
  async sendTransaction(signedTransaction) {
    // In production, use @solana/web3.js Connection.sendRawTransaction
    // For now, this is a placeholder
    
    // Simulated response for development
    console.log('[PumpPortal] Would send transaction:', signedTransaction.substring(0, 50) + '...');
    
    // TODO: Implement actual transaction sending
    // const connection = new Connection('https://api.mainnet-beta.solana.com');
    // const txBuffer = Buffer.from(signedTransaction, 'base64');
    // const signature = await connection.sendRawTransaction(txBuffer);
    // await connection.confirmTransaction(signature);
    
    return {
      success: true,
      signature: 'SIMULATED_' + Date.now().toString(36)
    };
  },

  /**
   * Generate a new mint keypair
   * @returns {string} Base58 public key
   */
  generateMintKeypair() {
    // In production, use @solana/web3.js Keypair.generate()
    // This is a placeholder
    console.log('[PumpPortal] Generating mint keypair...');
    
    // TODO: Implement actual keypair generation
    // const keypair = Keypair.generate();
    // return keypair.publicKey.toBase58();
    
    return 'MINT_' + Math.random().toString(36).substring(2, 15);
  },

  /**
   * Get file extension from blob
   * @param {Blob} blob 
   * @returns {string}
   */
  getExtension(blob) {
    const mimeToExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    return mimeToExt[blob.type] || 'png';
  },

  /**
   * Validate launch parameters
   * @param {Object} params 
   * @returns {Object} Validation result
   */
  validateParams(params) {
    const errors = [];

    if (!params.name || params.name.length < 1) {
      errors.push('Token name is required');
    }

    if (!params.ticker || params.ticker.length < 1) {
      errors.push('Token ticker/symbol is required');
    }

    if (params.ticker && params.ticker.length > 10) {
      errors.push('Token ticker should be 10 characters or less');
    }

    if (params.buyAmount && (params.buyAmount < 0 || params.buyAmount > 100)) {
      errors.push('Buy amount should be between 0 and 100 SOL');
    }

    if (params.slippage && (params.slippage < 1 || params.slippage > 50)) {
      errors.push('Slippage should be between 1% and 50%');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PumpPortal;
}
