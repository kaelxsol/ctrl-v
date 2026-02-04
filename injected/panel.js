// Beta Launch - Docked Panel
// Matches Axiom.trade's native panel docking behavior

(function() {
  'use strict';

  const PANEL_ID = 'acl-panel';
  const STORAGE_KEY = 'acl_panel_state';

  // Platform configurations
  const PLATFORMS = {
    pump: {
      name: 'Pump.fun',
      color: '#00ff88',
      logo: 'https://axiom.trade/images/pump.svg',
      ipfs: 'https://pump.fun/api/ipfs',
      trade: 'https://pumpportal.fun/api/trade-local'
    },
    bonk: {
      name: 'Bonk.fun',
      color: '#f7931a',
      logo: 'https://axiom.trade/images/bonk.svg',
      ipfsImage: 'https://nft-storage.letsbonk22.workers.dev/upload/img',
      ipfsMeta: 'https://nft-storage.letsbonk22.workers.dev/upload/meta'
    },
    bags: {
      name: 'Bags.fm',
      color: '#16a34a',
      logo: 'https://axiom.trade/images/bags.svg',
      requiresApiKey: true,
      tokenInfo: 'https://public-api-v2.bags.fm/api/v1/token-launch/create-token-info',
      launchTx: 'https://public-api-v2.bags.fm/api/v1/token-launch/create-launch-transaction'
    }
  };

  // RPC endpoint for sending transactions
  const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

  // Fee configuration (2% on Pump.fun launches only)
  const FEE_CONFIG = {
    enabled: true,
    percentage: 0.02, // 2%
    walletAddress: '3TS9UrUpwaBQctvtVeQg5HbUuArNqvoDELwcMXTGbBv1',
    minFeeLamports: 1000, // Minimum fee to avoid dust transactions
    platforms: ['pump'] // Only apply fee to these platforms (bonk builds tx differently)
  };

  // ==================== RAYDIUM LAUNCHPAD CONSTANTS (for Bonk.fun) ====================
  // These are the program addresses used by Bonk.fun (Raydium Launchpad)
  const RAYDIUM_LAUNCHPAD = {
    PROGRAM: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    AUTHORITY: 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh',
    GLOBAL_CONFIG: '6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX',
    PLATFORM_CONFIG: 'FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1',
    EVENT_AUTHORITY: '2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr',
    POOL_SEED: 'pool',
    POOL_VAULT_SEED: 'pool_vault'
  };

  const SOLANA_PROGRAMS = {
    SYSTEM: '11111111111111111111111111111111',
    TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ASSOCIATED_TOKEN: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    METAPLEX_METADATA: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
    RENT: 'SysvarRent111111111111111111111111111111111',
    WSOL: 'So11111111111111111111111111111111111111112'
  };

  // Token launch parameters (same defaults as bonk-mcp)
  const BONK_LAUNCH_PARAMS = {
    DECIMALS: 6,
    SUPPLY: '1000000000000000',           // 10^15 = 1 quadrillion (with 6 decimals = 1 billion tokens)
    BASE_SELL: '793100000000000',          // 79.31% of supply for sale
    QUOTE_RAISING: '85000000000',          // 85 SOL in lamports
    UNIT_PRICE: 2500000,                   // Compute budget price
    UNIT_BUDGET: 1000000,                  // Compute budget limit
    INSTRUCTION_DISCRIMINATOR: '4399af27da102620'  // initializeV2 discriminator from Raydium SDK
  };

  // Get extension config from script tag data attributes (set by content.js)
  // Must be captured immediately during script load - document.currentScript is only available during initial execution
  const SCRIPT_TAG = document.currentScript;
  const SOLANA_WEB3_URL = SCRIPT_TAG?.dataset?.solanaWeb3Url || null;
  const EXTENSION_ID = SCRIPT_TAG?.dataset?.extensionId || null;

  console.log('[ACL] Extension config:', { EXTENSION_ID, SOLANA_WEB3_URL: SOLANA_WEB3_URL ? 'loaded' : 'missing' });

  // ==================== SOLANA WEB3 LOADER ====================

  let solanaWeb3Loaded = false;

  async function loadSolanaWeb3() {
    if (solanaWeb3Loaded || window.solanaWeb3) {
      solanaWeb3Loaded = true;
      return window.solanaWeb3;
    }

    if (!SOLANA_WEB3_URL) {
      throw new Error('Solana web3.js URL not found - extension config may not be injected. Make sure the extension is properly loaded.');
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SOLANA_WEB3_URL;
      script.onload = () => {
        solanaWeb3Loaded = true;
        console.log('[ACL] @solana/web3.js loaded from extension bundle');
        resolve(window.solanaWeb3);
      };
      script.onerror = () => reject(new Error(`Failed to load @solana/web3.js from ${SOLANA_WEB3_URL}`));
      document.head.appendChild(script);
    });
  }

  // ==================== LAUNCH EXECUTION ====================

  async function downloadImage(imageUrl) {
    try {
      // Use proxyFetch to bypass CSP - will be handled after proxy is defined
      // For now, try direct fetch first, fall back to proxy
      let blob;
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Direct fetch failed: ${response.status}`);
        blob = await response.blob();
      } catch (directErr) {
        console.log('[ACL] Direct image fetch blocked by CSP, using proxy');
        const response = await proxyFetch(imageUrl, { responseType: 'arraybuffer' });
        if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
        // Reconstruct blob from array buffer, detect type from URL or default
        const uint8Array = new Uint8Array(response.data);
        let mimeType = 'image/png';
        const urlLower = imageUrl.toLowerCase();
        if (urlLower.includes('.webp')) mimeType = 'image/webp';
        else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) mimeType = 'image/jpeg';
        else if (urlLower.includes('.gif')) mimeType = 'image/gif';
        else if (urlLower.includes('.png')) mimeType = 'image/png';
        blob = new Blob([uint8Array], { type: mimeType });
      }
      return blob;
    } catch (err) {
      console.error('[ACL] Image download error:', err);
      return null;
    }
  }

  /**
   * Convert image blob to PNG format using canvas
   * Required for platforms that don't accept WebP (like Bonk.fun)
   */
  async function convertToPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error('Failed to convert to PNG'));
          }
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Failed to load image for conversion'));
      img.src = URL.createObjectURL(blob);
    });
  }

  // ==================== FETCH PROXY ====================
  // Routes fetch requests through content script to bypass page CSP

  let fetchRequestId = 0;
  const pendingFetches = new Map();

  // Listen for fetch responses from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'ACL_FETCH_RESPONSE') {
      const { requestId, success, ok, status, responseType, data, error } = event.data;
      const pending = pendingFetches.get(requestId);
      if (pending) {
        pendingFetches.delete(requestId);
        if (success) {
          pending.resolve({ ok, status, responseType, data });
        } else {
          pending.reject(new Error(error));
        }
      }
    }
  });

  async function proxyFetch(url, options = {}) {
    const requestId = ++fetchRequestId;
    
    // Serialize FormData if present
    let serializedOptions = { ...options };
    if (options.body instanceof FormData) {
      const entries = [];
      for (const [key, value] of options.body.entries()) {
        if (value instanceof Blob) {
          // Convert blob to base64
          const reader = new FileReader();
          const base64 = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(value);
          });
          entries.push({
            key,
            isBlob: true,
            value: { data: base64, type: value.type, name: value.name || 'file' }
          });
        } else {
          entries.push({ key, isBlob: false, value });
        }
      }
      serializedOptions.bodyType = 'formdata';
      serializedOptions.formDataEntries = entries;
      delete serializedOptions.body;
    }
    
    return new Promise((resolve, reject) => {
      pendingFetches.set(requestId, { resolve, reject });
      
      window.postMessage({
        type: 'ACL_FETCH_PROXY',
        requestId,
        url,
        options: serializedOptions
      }, '*');
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (pendingFetches.has(requestId)) {
          pendingFetches.delete(requestId);
          reject(new Error('Fetch proxy timeout'));
        }
      }, 60000);
    });
  }

  async function generateMintKeypair() {
    const web3 = await loadSolanaWeb3();
    const keypair = web3.Keypair.generate();
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: keypair.secretKey
    };
  }

  /**
   * Get the configured RPC endpoint URL
   */
  function getRpcEndpoint() {
    // rpcConfig is set from user settings
    if (typeof rpcConfig !== 'undefined' && rpcConfig) {
      if (rpcConfig.type === 'helius' && rpcConfig.heliusKey) {
        return `https://mainnet.helius-rpc.com/?api-key=${rpcConfig.heliusKey}`;
      } else if (rpcConfig.type === 'custom' && rpcConfig.customUrl) {
        return rpcConfig.customUrl;
      }
    }
    // Fallback to default
    return RPC_ENDPOINT;
  }

  /**
   * Make a JSON-RPC call to Solana via proxy to bypass CSP
   */
  async function proxyRpcCall(method, params = []) {
    const endpoint = getRpcEndpoint();
    console.log('[ACL] RPC call to:', endpoint.includes('api-key') ? endpoint.split('?')[0] + '?api-key=***' : endpoint);
    
    const response = await proxyFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      })
    });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('RPC rate limited (403). Go to Settings and configure a Helius API key (free tier available).');
      }
      throw new Error(`RPC call failed: ${response.status}`);
    }

    const result = response.data;
    if (result.error) {
      throw new Error(`RPC error: ${result.error.message}`);
    }

    return result.result;
  }

  /**
   * Get latest blockhash via proxy
   */
  async function getLatestBlockhashProxy() {
    const result = await proxyRpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    return {
      blockhash: result.value.blockhash,
      lastValidBlockHeight: result.value.lastValidBlockHeight
    };
  }

  /**
   * Send raw transaction via proxy
   */
  async function sendRawTransactionProxy(serializedTx, options = {}) {
    // Convert Uint8Array to base64
    const base64Tx = btoa(String.fromCharCode(...serializedTx));
    const result = await proxyRpcCall('sendTransaction', [
      base64Tx,
      {
        encoding: 'base64',
        skipPreflight: options.skipPreflight ?? false,
        preflightCommitment: options.preflightCommitment ?? 'confirmed'
      }
    ]);
    return result; // Returns signature string
  }

  async function uploadToPumpIPFS(metadata, imageBlob) {
    const formData = new FormData();

    if (imageBlob) {
      const ext = imageBlob.type?.split('/')[1] || 'png';
      formData.append('file', imageBlob, `token.${ext}`);
    }

    formData.append('name', metadata.name);
    formData.append('symbol', metadata.ticker);
    formData.append('description', metadata.description || '');
    formData.append('showName', 'true');
    if (metadata.twitter) formData.append('twitter', metadata.twitter);
    if (metadata.telegram) formData.append('telegram', metadata.telegram);
    if (metadata.website) formData.append('website', metadata.website);

    // Use proxyFetch to bypass CSP restrictions
    const response = await proxyFetch(PLATFORMS.pump.ipfs, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.status} - ${response.data}`);
    }

    return response.data;
  }

  async function createPumpTransaction(publicKey, tokenMetadata, mintPublicKey, buyAmount, slippage) {
    // Use proxyFetch to bypass CSP restrictions
    const response = await proxyFetch(PLATFORMS.pump.trade, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKey,
        action: 'create',
        tokenMetadata: tokenMetadata,
        mint: mintPublicKey,
        denominatedInSol: 'true',
        amount: buyAmount || 0,
        slippage: slippage || 10,
        priorityFee: 0.0005,
        pool: 'pump'
      }),
      responseType: 'arraybuffer'
    });

    if (!response.ok) {
      throw new Error(`Transaction creation failed: ${response.status} - ${response.data}`);
    }

    // Response is already parsed as array by the proxy
    return new Uint8Array(response.data);
  }

  // ==================== BONK.FUN FUNCTIONS ====================

  /**
   * Create Bonk transaction via PumpPortal (no API key needed for local signing)
   */
  async function createBonkTransactionViaPumpPortal(publicKey, tokenMetadata, mintPublicKey, buyAmount, slippage) {
    const response = await proxyFetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKey,
        action: 'create',
        tokenMetadata: tokenMetadata,
        mint: mintPublicKey,
        denominatedInSol: 'true',
        amount: buyAmount || 0,
        slippage: slippage || 10,
        priorityFee: 0.0005,
        pool: 'bonk'
      }),
      responseType: 'arraybuffer'
    });

    if (!response.ok) {
      const errText = response.data ? String.fromCharCode(...new Uint8Array(response.data)) : response.status;
      throw new Error(`Bonk transaction creation failed: ${errText}`);
    }

    return new Uint8Array(response.data);
  }

  async function uploadToBonkIPFS(metadata, imageBlob) {
    // Step 1: Convert to PNG if WebP (Bonk only accepts PNG, JPEG, GIF)
    let uploadBlob = imageBlob;
    if (imageBlob.type === 'image/webp') {
      console.log('[ACL] Converting WebP to PNG for Bonk upload...');
      uploadBlob = await convertToPng(imageBlob);
    }
    
    // Step 2: Upload image
    const imageFormData = new FormData();
    const ext = uploadBlob.type?.split('/')[1] || 'png';
    console.log('[ACL] Bonk image upload - type:', uploadBlob.type, 'size:', uploadBlob.size, 'ext:', ext);
    imageFormData.append('image', uploadBlob, `token.${ext}`);

    const imgResponse = await proxyFetch(PLATFORMS.bonk.ipfsImage, {
      method: 'POST',
      body: imageFormData
    });

    if (!imgResponse.ok) {
      console.error('[ACL] Bonk image error response:', imgResponse.data);
      throw new Error(`Bonk image upload failed: ${imgResponse.status} - ${JSON.stringify(imgResponse.data)}`);
    }

    const imageUri = imgResponse.data;
    console.log('[ACL] Bonk image uploaded:', imageUri);

    // Step 2: Upload metadata (with length limits: name 32, symbol 10)
    // Bonk requires non-empty description
    const desc = (metadata.description || '').trim();
    const metaPayload = {
      createdOn: 'https://bonk.fun',
      name: metadata.name.substring(0, 31),
      symbol: metadata.ticker.substring(0, 7).toUpperCase(),
      description: desc.length > 0 ? desc.substring(0, 1000) : `${metadata.name} - launched via Beta Launch`,
      image: imageUri
    };
    
    // Only add optional fields if they have values
    if (metadata.website) metaPayload.website = metadata.website;
    if (metadata.twitter) metaPayload.twitter = metadata.twitter;
    if (metadata.telegram) metaPayload.telegram = metadata.telegram;
    
    console.log('[ACL] Bonk metadata payload:', metaPayload);

    const metaResponse = await proxyFetch(PLATFORMS.bonk.ipfsMeta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload)
    });

    if (!metaResponse.ok) {
      console.error('[ACL] Bonk metadata error response:', metaResponse.data);
      throw new Error(`Bonk metadata upload failed: ${metaResponse.status} - ${JSON.stringify(metaResponse.data)}`);
    }

    const metadataUri = metaResponse.data;
    console.log('[ACL] Bonk metadata uploaded:', metadataUri);

    return { metadataUri, imageUri };
  }

  // ==================== RAYDIUM LAUNCHPAD TRANSACTION BUILDING ====================

  /**
   * Derive PDAs for Raydium Launchpad token
   * Based on bonk-mcp: https://github.com/letsbonk-ai/bonk-mcp/blob/main/src/bonk_mcp/core/letsbonk.py
   */
  async function deriveBonkPDAs(mintPubkey, web3) {
    const raydiumProgram = new web3.PublicKey(RAYDIUM_LAUNCHPAD.PROGRAM);
    const metaplexProgram = new web3.PublicKey(SOLANA_PROGRAMS.METAPLEX_METADATA);
    const wsolMint = new web3.PublicKey(SOLANA_PROGRAMS.WSOL);

    // Helper to convert string to Uint8Array (browser-compatible Buffer alternative)
    const toBytes = (str) => new TextEncoder().encode(str);

    // Pool state PDA: seeds = ["pool", mint_pubkey, quote_mint (WSOL)]
    // CRITICAL: Must include WSOL mint as third seed!
    const [poolState] = web3.PublicKey.findProgramAddressSync(
      [toBytes(RAYDIUM_LAUNCHPAD.POOL_SEED), mintPubkey.toBuffer(), wsolMint.toBuffer()],
      raydiumProgram
    );

    // Base vault PDA: seeds = ["pool_vault", pool_state, mint_pubkey]
    const [baseVault] = web3.PublicKey.findProgramAddressSync(
      [toBytes(RAYDIUM_LAUNCHPAD.POOL_VAULT_SEED), poolState.toBuffer(), mintPubkey.toBuffer()],
      raydiumProgram
    );

    // Quote vault PDA: seeds = ["pool_vault", pool_state, wsol_mint]
    const [quoteVault] = web3.PublicKey.findProgramAddressSync(
      [toBytes(RAYDIUM_LAUNCHPAD.POOL_VAULT_SEED), poolState.toBuffer(), wsolMint.toBuffer()],
      raydiumProgram
    );

    // Metadata PDA: seeds = ["metadata", metaplex_program, mint_pubkey]
    const [metadata] = web3.PublicKey.findProgramAddressSync(
      [toBytes('metadata'), metaplexProgram.toBuffer(), mintPubkey.toBuffer()],
      metaplexProgram
    );

    return { poolState, baseVault, quoteVault, metadata };
  }

  /**
   * Create buffer from string with length prefix (for Anchor serialization)
   */
  function bufferFromString(str) {
    const strBytes = new TextEncoder().encode(str);
    const len = strBytes.length;
    // Length prefix as 4 bytes (u32 little endian)
    const result = new Uint8Array(4 + len);
    result[0] = len & 0xff;
    result[1] = (len >> 8) & 0xff;
    result[2] = (len >> 16) & 0xff;
    result[3] = (len >> 24) & 0xff;
    result.set(strBytes, 4);
    return result;
  }

  /**
   * Pack a u64 value as little-endian bytes
   */
  function packU64(value) {
    const bigVal = BigInt(value);
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      bytes[i] = Number((bigVal >> BigInt(8 * i)) & BigInt(0xff));
    }
    return bytes;
  }

  /**
   * Create the launch instruction data for Raydium Launchpad
   */
  function createLaunchInstructionData(name, symbol, uri) {
    const parts = [];

    // Instruction discriminator (8 bytes)
    const discriminator = new Uint8Array(8);
    const discHex = BONK_LAUNCH_PARAMS.INSTRUCTION_DISCRIMINATOR;
    for (let i = 0; i < 8; i++) {
      discriminator[i] = parseInt(discHex.substr(i * 2, 2), 16);
    }
    parts.push(discriminator);

    // Mint parameters
    // Decimals (u8)
    parts.push(new Uint8Array([BONK_LAUNCH_PARAMS.DECIMALS]));
    // Name (string with length prefix)
    parts.push(bufferFromString(name.substring(0, 31)));
    // Symbol (string with length prefix)
    parts.push(bufferFromString(symbol.substring(0, 7).toUpperCase()));
    // URI (string with length prefix)
    parts.push(bufferFromString(uri));

    // Curve parameters
    // Variant discriminator for Constant curve (0)
    parts.push(new Uint8Array([0]));
    // Supply (u64)
    parts.push(packU64(BONK_LAUNCH_PARAMS.SUPPLY));
    // Total base sell (u64)
    parts.push(packU64(BONK_LAUNCH_PARAMS.BASE_SELL));
    // Total quote fund raising (u64)
    parts.push(packU64(BONK_LAUNCH_PARAMS.QUOTE_RAISING));
    // Migrate type (u8)
    parts.push(new Uint8Array([1]));

    // Vesting parameters (all zeros)
    // Total locked amount (u64)
    parts.push(packU64(0));
    // Cliff period (u64)
    parts.push(packU64(0));
    // Unlock period (u64)
    parts.push(packU64(0));
    // cpmmCreatorFeeOn (u8) - required for initializeV2
    parts.push(new Uint8Array([0]));

    // Concatenate all parts
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const data = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }

    return data;
  }

  /**
   * Build the complete Bonk.fun (Raydium Launchpad) transaction with optional dev buy
   */
  async function createBonkLaunchTransaction(payerPubkey, mintKeypair, name, symbol, uri, web3, buyAmountSol = 0) {
    const raydiumProgram = new web3.PublicKey(RAYDIUM_LAUNCHPAD.PROGRAM);
    const systemProgram = new web3.PublicKey(SOLANA_PROGRAMS.SYSTEM);
    const tokenProgram = new web3.PublicKey(SOLANA_PROGRAMS.TOKEN);
    const assocTokenProgram = new web3.PublicKey(SOLANA_PROGRAMS.ASSOCIATED_TOKEN);
    const metaplexProgram = new web3.PublicKey(SOLANA_PROGRAMS.METAPLEX_METADATA);
    const rent = new web3.PublicKey(SOLANA_PROGRAMS.RENT);
    const wsolMint = new web3.PublicKey(SOLANA_PROGRAMS.WSOL);

    const authority = new web3.PublicKey(RAYDIUM_LAUNCHPAD.AUTHORITY);
    const globalConfig = new web3.PublicKey(RAYDIUM_LAUNCHPAD.GLOBAL_CONFIG);
    const platformConfig = new web3.PublicKey(RAYDIUM_LAUNCHPAD.PLATFORM_CONFIG);
    const eventAuthority = new web3.PublicKey(RAYDIUM_LAUNCHPAD.EVENT_AUTHORITY);

    // Derive PDAs
    const pdas = await deriveBonkPDAs(mintKeypair.publicKey, web3);
    console.log('[ACL] Derived PDAs:', {
      poolState: pdas.poolState.toBase58(),
      baseVault: pdas.baseVault.toBase58(),
      quoteVault: pdas.quoteVault.toBase58(),
      metadata: pdas.metadata.toBase58()
    });

    // Get recent blockhash via proxy to bypass CSP
    const { blockhash, lastValidBlockHeight } = await getLatestBlockhashProxy();
    console.log('[ACL] Got blockhash:', blockhash);

    // Create launch instruction data
    const instructionData = createLaunchInstructionData(name, symbol, uri);

    // Build account keys for the instruction (order matters!)
    // Ref: https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/instrument.ts
    const keys = [
      { pubkey: payerPubkey, isSigner: true, isWritable: true },           // Payer
      { pubkey: payerPubkey, isSigner: false, isWritable: false },         // Creator (same as payer but not signer)
      { pubkey: globalConfig, isSigner: false, isWritable: false },        // Global config
      { pubkey: platformConfig, isSigner: false, isWritable: false },      // Platform config
      { pubkey: authority, isSigner: false, isWritable: false },           // Authority
      { pubkey: pdas.poolState, isSigner: false, isWritable: true },       // Pool state
      { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }, // Base mint (new token)
      { pubkey: wsolMint, isSigner: false, isWritable: false },            // Quote token (WSOL)
      { pubkey: pdas.baseVault, isSigner: false, isWritable: true },       // Base vault
      { pubkey: pdas.quoteVault, isSigner: false, isWritable: true },      // Quote vault
      { pubkey: pdas.metadata, isSigner: false, isWritable: true },        // Metadata
      { pubkey: tokenProgram, isSigner: false, isWritable: false },        // Base token program
      { pubkey: tokenProgram, isSigner: false, isWritable: false },        // Quote token program
      { pubkey: metaplexProgram, isSigner: false, isWritable: false },     // Metadata program
      { pubkey: systemProgram, isSigner: false, isWritable: false },       // System program
      { pubkey: rent, isSigner: false, isWritable: false },                // Rent sysvar
      { pubkey: eventAuthority, isSigner: false, isWritable: false },      // Event authority
      { pubkey: raydiumProgram, isSigner: false, isWritable: false },      // Raydium program
    ];

    // Create the launch instruction
    const launchInstruction = new web3.TransactionInstruction({
      keys,
      programId: raydiumProgram,
      data: instructionData
    });

    // Create compute budget instructions
    const computeBudgetProgram = new web3.PublicKey('ComputeBudget111111111111111111111111111111');
    
    // Set compute unit price
    const unitPriceData = new Uint8Array(9);
    unitPriceData[0] = 3; // SetComputeUnitPrice instruction index
    const priceBytes = packU64(BONK_LAUNCH_PARAMS.UNIT_PRICE);
    unitPriceData.set(priceBytes, 1);
    
    const setPriceIx = new web3.TransactionInstruction({
      keys: [],
      programId: computeBudgetProgram,
      data: unitPriceData
    });

    // Set compute unit limit
    const unitLimitData = new Uint8Array(5);
    unitLimitData[0] = 2; // SetComputeUnitLimit instruction index
    const limitVal = BONK_LAUNCH_PARAMS.UNIT_BUDGET;
    unitLimitData[1] = limitVal & 0xff;
    unitLimitData[2] = (limitVal >> 8) & 0xff;
    unitLimitData[3] = (limitVal >> 16) & 0xff;
    unitLimitData[4] = (limitVal >> 24) & 0xff;
    
    const setLimitIx = new web3.TransactionInstruction({
      keys: [],
      programId: computeBudgetProgram,
      data: unitLimitData
    });

    // Build the transaction
    const transaction = new web3.Transaction();
    transaction.add(setLimitIx);
    transaction.add(setPriceIx);
    transaction.add(launchInstruction);

    // Add dev buy instruction if buyAmount > 0
    if (buyAmountSol && buyAmountSol > 0) {
      const buyAmountLamports = Math.floor(buyAmountSol * 1e9);

      // Derive user's Associated Token Account for the new token
      const [userTokenAccountA] = web3.PublicKey.findProgramAddressSync(
        [payerPubkey.toBuffer(), tokenProgram.toBuffer(), mintKeypair.publicKey.toBuffer()],
        assocTokenProgram
      );

      // Derive user's WSOL Associated Token Account
      const [userTokenAccountB] = web3.PublicKey.findProgramAddressSync(
        [payerPubkey.toBuffer(), tokenProgram.toBuffer(), wsolMint.toBuffer()],
        assocTokenProgram
      );

      // Derive fee vaults (creator and platform claim fee vaults)
      const [creatorClaimFeeVault] = web3.PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('creator_claim_fee'), pdas.poolState.toBuffer()],
        raydiumProgram
      );
      const [platformClaimFeeVault] = web3.PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('platform_claim_fee'), pdas.poolState.toBuffer()],
        raydiumProgram
      );

      // Create ATA for new token (will hold purchased tokens)
      const createAtaIx = new web3.TransactionInstruction({
        keys: [
          { pubkey: payerPubkey, isSigner: true, isWritable: true },
          { pubkey: userTokenAccountA, isSigner: false, isWritable: true },
          { pubkey: payerPubkey, isSigner: false, isWritable: false },
          { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false },
          { pubkey: systemProgram, isSigner: false, isWritable: false },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ],
        programId: assocTokenProgram,
        data: new Uint8Array(0) // Create ATA instruction has no data
      });
      transaction.add(createAtaIx);

      // Create WSOL ATA and fund it
      const createWsolAtaIx = new web3.TransactionInstruction({
        keys: [
          { pubkey: payerPubkey, isSigner: true, isWritable: true },
          { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
          { pubkey: payerPubkey, isSigner: false, isWritable: false },
          { pubkey: wsolMint, isSigner: false, isWritable: false },
          { pubkey: systemProgram, isSigner: false, isWritable: false },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ],
        programId: assocTokenProgram,
        data: new Uint8Array(0)
      });
      transaction.add(createWsolAtaIx);

      // Transfer SOL to WSOL account
      const transferIx = web3.SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: userTokenAccountB,
        lamports: buyAmountLamports
      });
      transaction.add(transferIx);

      // Sync native (wrap SOL to WSOL)
      const syncNativeData = new Uint8Array([17]); // SyncNative instruction index
      const syncNativeIx = new web3.TransactionInstruction({
        keys: [{ pubkey: userTokenAccountB, isSigner: false, isWritable: true }],
        programId: tokenProgram,
        data: syncNativeData
      });
      transaction.add(syncNativeIx);

      // Buy instruction discriminator: [250, 234, 13, 123, 213, 156, 19, 236]
      const buyDiscriminator = new Uint8Array([250, 234, 13, 123, 213, 156, 19, 236]);

      // Calculate minimum tokens out (with slippage)
      // For simplicity, set minAmountA to 1 (accept any amount)
      const minAmountA = BigInt(1);
      const shareFeeRate = BigInt(0);

      // Pack buy instruction data: discriminator + amountB (u64) + minAmountA (u64) + shareFeeRate (u64)
      const buyData = new Uint8Array(8 + 8 + 8 + 8);
      buyData.set(buyDiscriminator, 0);
      buyData.set(packU64(buyAmountLamports), 8);
      buyData.set(packU64(Number(minAmountA)), 16);
      buyData.set(packU64(Number(shareFeeRate)), 24);

      // Buy instruction accounts
      const buyKeys = [
        { pubkey: payerPubkey, isSigner: true, isWritable: true },           // owner
        { pubkey: authority, isSigner: false, isWritable: false },           // auth
        { pubkey: globalConfig, isSigner: false, isWritable: false },        // configId
        { pubkey: platformConfig, isSigner: false, isWritable: false },      // platformId
        { pubkey: pdas.poolState, isSigner: false, isWritable: true },       // poolId
        { pubkey: userTokenAccountA, isSigner: false, isWritable: true },    // userTokenAccountA
        { pubkey: userTokenAccountB, isSigner: false, isWritable: true },    // userTokenAccountB
        { pubkey: pdas.baseVault, isSigner: false, isWritable: true },       // vaultA
        { pubkey: pdas.quoteVault, isSigner: false, isWritable: true },      // vaultB
        { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false }, // mintA
        { pubkey: wsolMint, isSigner: false, isWritable: false },            // mintB
        { pubkey: tokenProgram, isSigner: false, isWritable: false },        // tokenProgramA
        { pubkey: tokenProgram, isSigner: false, isWritable: false },        // tokenProgramB
        { pubkey: eventAuthority, isSigner: false, isWritable: false },      // cpiEvent
        { pubkey: raydiumProgram, isSigner: false, isWritable: false },      // programId
        { pubkey: systemProgram, isSigner: false, isWritable: false },       // SystemProgram
        { pubkey: platformClaimFeeVault, isSigner: false, isWritable: true }, // platformClaimFeeVault
        { pubkey: creatorClaimFeeVault, isSigner: false, isWritable: true }, // creatorClaimFeeVault
      ];

      const buyIx = new web3.TransactionInstruction({
        keys: buyKeys,
        programId: raydiumProgram,
        data: buyData
      });
      transaction.add(buyIx);

      // Close WSOL account to recover rent (optional but good practice)
      const closeAccountData = new Uint8Array([9]); // CloseAccount instruction index
      const closeWsolIx = new web3.TransactionInstruction({
        keys: [
          { pubkey: userTokenAccountB, isSigner: false, isWritable: true },
          { pubkey: payerPubkey, isSigner: false, isWritable: true },
          { pubkey: payerPubkey, isSigner: true, isWritable: false },
        ],
        programId: tokenProgram,
        data: closeAccountData
      });
      transaction.add(closeWsolIx);

      console.log('[ACL] Added dev buy instruction for', buyAmountSol, 'SOL');
    }

    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payerPubkey;

    return { transaction, pdas };
  }

  // Settings state (loaded from storage)
  let autosignEnabled = false;
  let storedPrivateKey = null;

  /**
   * Send a 2% fee transaction before the main launch
   * @param {number} buyAmountSol - The buy amount in SOL
   * @returns {Promise<string|null>} - Fee transaction signature or null if skipped
   */
  async function sendFeeTransaction(buyAmountSol) {
    if (!FEE_CONFIG.enabled || !buyAmountSol || buyAmountSol <= 0) {
      return null;
    }

    const feeLamports = Math.floor(buyAmountSol * FEE_CONFIG.percentage * 1e9);

    // Skip if fee is too small
    if (feeLamports < FEE_CONFIG.minFeeLamports) {
      console.log('[ACL] Fee too small, skipping:', feeLamports, 'lamports');
      return null;
    }

    const feeAmountSol = feeLamports / 1e9;
    console.log(`[ACL] Sending ${FEE_CONFIG.percentage * 100}% fee: ${feeAmountSol} SOL to ${FEE_CONFIG.walletAddress}`);
    console.log('[ACL] Fee tx auto-sign check:', { autosignEnabled, hasPrivateKey: !!storedPrivateKey });

    const web3 = await loadSolanaWeb3();

    // Get recent blockhash via proxy (bypasses CORS)
    const blockhashResult = await proxyRpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    if (!blockhashResult?.value?.blockhash) {
      throw new Error('Failed to get blockhash for fee transaction');
    }
    const blockhash = blockhashResult.value.blockhash;
    console.log('[ACL] Fee tx blockhash:', blockhash);

    // Create fee transfer instruction
    const fromPubkey = new web3.PublicKey(walletState.fullAddress);
    const toPubkey = new web3.PublicKey(FEE_CONFIG.walletAddress);

    const transferInstruction = web3.SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: feeLamports
    });

    // Build legacy transaction (simpler for single transfer)
    const transaction = new web3.Transaction();
    transaction.add(transferInstruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPubkey;

    let signature;

    // Check if auto-sign is enabled
    if (autosignEnabled && storedPrivateKey) {
      console.log('[ACL] Using auto-sign for fee transaction');

      // Decode base58 private key
      const bs58Decode = (str) => {
        const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
          let carry = ALPHABET.indexOf(str[i]);
          if (carry < 0) throw new Error('Invalid base58 character');
          for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
          }
          while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
          }
        }
        for (let i = 0; i < str.length && str[i] === '1'; i++) {
          bytes.push(0);
        }
        return new Uint8Array(bytes.reverse());
      };

      const secretKeyBytes = bs58Decode(storedPrivateKey);
      const walletKeypair = web3.Keypair.fromSecretKey(secretKeyBytes);

      transaction.sign(walletKeypair);

      // Send via proxy to bypass CORS
      signature = await sendRawTransactionProxy(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
    } else {
      // Use Phantom wallet
      if (!window.solana?.isPhantom) {
        throw new Error('Phantom wallet required for fee transaction');
      }

      const result = await window.solana.signAndSendTransaction(transaction);
      signature = result.signature;
    }

    console.log('[ACL] Fee transaction sent:', signature);
    return { signature, feeAmountSol: feeAmountSol };
  }

  async function signAndSendTransaction(txBytes, mintSecretKey) {
    const web3 = await loadSolanaWeb3();

    // Deserialize the transaction from PumpPortal
    const transaction = web3.VersionedTransaction.deserialize(txBytes);
    console.log('[ACL] Transaction deserialized, version:', transaction.version);

    // Sign with mint keypair first (required for token creation)
    if (mintSecretKey) {
      const mintKeypair = web3.Keypair.fromSecretKey(mintSecretKey);
      transaction.sign([mintKeypair]);
      console.log('[ACL] Transaction signed with mint keypair');
    }

    // Check if auto-sign is enabled and we have a private key
    if (autosignEnabled && storedPrivateKey) {
      console.log('[ACL] Using auto-sign mode with stored private key');
      
      // Decode the private key (base58)
      const bs58 = {
        decode: (str) => {
          const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
          const bytes = [];
          for (let i = 0; i < str.length; i++) {
            let carry = ALPHABET.indexOf(str[i]);
            if (carry < 0) throw new Error('Invalid base58 character');
            for (let j = 0; j < bytes.length; j++) {
              carry += bytes[j] * 58;
              bytes[j] = carry & 0xff;
              carry >>= 8;
            }
            while (carry > 0) {
              bytes.push(carry & 0xff);
              carry >>= 8;
            }
          }
          // Add leading zeros
          for (let i = 0; i < str.length && str[i] === '1'; i++) {
            bytes.push(0);
          }
          return new Uint8Array(bytes.reverse());
        }
      };
      
      const secretKeyBytes = bs58.decode(storedPrivateKey);
      const walletKeypair = web3.Keypair.fromSecretKey(secretKeyBytes);
      
      // Sign with wallet keypair
      transaction.sign([walletKeypair]);
      console.log('[ACL] Transaction signed with wallet keypair (auto-sign)');
      
      // Send the transaction via proxy to bypass CSP
      const signature = await sendRawTransactionProxy(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      
      console.log('[ACL] Transaction sent via RPC, signature:', signature);
      return signature;
    }

    // Fall back to Phantom wallet signing
    if (!window.solana?.isPhantom) {
      throw new Error('Phantom wallet not available. Enable auto-sign or install Phantom.');
    }

    const { signature } = await window.solana.signAndSendTransaction(transaction);
    console.log('[ACL] Transaction sent, signature:', signature);

    return signature;
  }

  async function executePumpLaunch(launchData) {
    const { name, ticker, description, twitter, telegram, website, imageUrl, buyAmount, slippage } = launchData;

    // Pre-load Solana Web3 if not already loaded
    await loadSolanaWeb3();

    // Step 1: Use custom image or download from URL
    let imageBlob;
    if (customImageBlob) {
      showStatus('Using custom image...', 'info');
      imageBlob = customImageBlob;
    } else {
      showStatus('Downloading image...', 'info');
      imageBlob = await downloadImage(imageUrl);
    }

    // Step 2: Upload to IPFS
    showStatus('Uploading to IPFS...', 'info');
    const ipfsResult = await uploadToPumpIPFS({
      name, ticker, description, twitter, telegram, website
    }, imageBlob);

    if (!ipfsResult.metadataUri) {
      throw new Error('Failed to get metadata URI');
    }

    console.log('[ACL] IPFS upload complete:', ipfsResult);

    // Step 3: Check wallet
    if (!walletState.fullAddress) {
      throw new Error('Wallet not connected');
    }

    // Step 3.5: Send 2% fee transaction (if enabled and buyAmount > 0)
    let feeSignature = null;
    let netBuyAmount = buyAmount;
    if (buyAmount > 0 && FEE_CONFIG.enabled) {
      showStatus(`Sending ${FEE_CONFIG.percentage * 100}% fee...`, 'info');
      const feeResult = await sendFeeTransaction(buyAmount);
      if (feeResult) {
        feeSignature = feeResult.signature;
        netBuyAmount = buyAmount - feeResult.feeAmountSol;
        console.log('[ACL] Fee sent:', feeResult.feeAmountSol, 'SOL, net buy:', netBuyAmount, 'SOL');
      }
    }

    // Step 4: Generate mint keypair
    showStatus('Generating token mint...', 'info');
    const mintKeypair = await generateMintKeypair();
    console.log('[ACL] Mint address:', mintKeypair.publicKey);

    // Step 5: Create transaction via PumpPortal (using net amount after fee)
    showStatus('Creating transaction...', 'info');
    const txBytes = await createPumpTransaction(
      walletState.fullAddress,
      {
        name: name,
        symbol: ticker,
        uri: ipfsResult.metadataUri
      },
      mintKeypair.publicKey,
      netBuyAmount,
      slippage
    );

    // Step 6: Sign and send
    showStatus('Please approve in wallet...', 'info');
    const signature = await signAndSendTransaction(txBytes, mintKeypair.secretKey);

    return {
      success: true,
      signature: signature,
      mintAddress: mintKeypair.publicKey,
      metadataUri: ipfsResult.metadataUri,
      feeSignature: feeSignature
    };
  }

  async function executeBonkLaunch(launchData) {
    const { name, ticker, description, twitter, telegram, website, imageUrl, buyAmount, slippage } = launchData;

    // Debug: Log auto-sign state at start
    console.log('[ACL] executeBonkLaunch starting, auto-sign state:', { 
      autosignEnabled, 
      hasPrivateKey: !!storedPrivateKey,
      privateKeyLength: storedPrivateKey ? storedPrivateKey.length : 0
    });

    // Pre-load Solana Web3
    const web3 = await loadSolanaWeb3();

    // Step 1: Use custom image or download from URL
    let imageBlob;
    if (customImageBlob) {
      showStatus('Using custom image...', 'info');
      imageBlob = customImageBlob;
    } else {
      showStatus('Downloading image...', 'info');
      imageBlob = await downloadImage(imageUrl);
    }

    // Step 2: Upload to Bonk IPFS
    showStatus('Uploading to Bonk IPFS...', 'info');
    const ipfsResult = await uploadToBonkIPFS({
      name, ticker, description, twitter, telegram, website
    }, imageBlob);

    if (!ipfsResult.metadataUri) {
      throw new Error('Failed to get metadata URI');
    }

    console.log('[ACL] Bonk IPFS upload complete:', ipfsResult);

    // Step 3: Check wallet
    if (!walletState.fullAddress) {
      throw new Error('Wallet not connected');
    }

    const payerPubkey = new web3.PublicKey(walletState.fullAddress);

    // Step 4: Generate mint keypair (no fee for Bonk - Raydium has strict requirements)
    showStatus('Generating token mint...', 'info');
    const mintKeypair = web3.Keypair.generate();
    console.log('[ACL] Bonk mint address:', mintKeypair.publicKey.toBase58());

    // Step 5: Build the transaction using Raydium Launchpad directly
    showStatus('Building Raydium Launchpad transaction...', 'info');
    const { transaction, pdas } = await createBonkLaunchTransaction(
      payerPubkey,
      mintKeypair,
      name,
      ticker,
      ipfsResult.metadataUri,
      web3,
      buyAmount || 0
    );

    console.log('[ACL] Transaction built, pool state:', pdas.poolState.toBase58());

    // Step 6: Sign with mint keypair
    showStatus('Please approve in wallet...', 'info');
    transaction.partialSign(mintKeypair);
    console.log('[ACL] Transaction signed with mint keypair');

    // Check if auto-sign is enabled
    console.log('[ACL] Auto-sign check:', { autosignEnabled, hasPrivateKey: !!storedPrivateKey });
    if (autosignEnabled && storedPrivateKey) {
      console.log('[ACL] Using auto-sign mode for Bonk launch');

      const bs58 = {
        decode: (str) => {
          const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
          const bytes = [];
          for (let i = 0; i < str.length; i++) {
            let carry = ALPHABET.indexOf(str[i]);
            if (carry < 0) throw new Error('Invalid base58 character');
            for (let j = 0; j < bytes.length; j++) {
              carry += bytes[j] * 58;
              bytes[j] = carry & 0xff;
              carry >>= 8;
            }
            while (carry > 0) {
              bytes.push(carry & 0xff);
              carry >>= 8;
            }
          }
          for (let i = 0; i < str.length && str[i] === '1'; i++) {
            bytes.push(0);
          }
          return new Uint8Array(bytes.reverse());
        }
      };

      const secretKeyBytes = bs58.decode(storedPrivateKey);
      const walletKeypair = web3.Keypair.fromSecretKey(secretKeyBytes);

      // Sign with wallet keypair
      transaction.partialSign(walletKeypair);
      console.log('[ACL] Transaction signed with wallet keypair (auto-sign)');

      // Send the transaction via proxy
      const signature = await sendRawTransactionProxy(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });

      console.log('[ACL] Bonk transaction sent, signature:', signature);

      return {
        success: true,
        signature: signature,
        mintAddress: mintKeypair.publicKey.toBase58(),
        metadataUri: ipfsResult.metadataUri,
        poolState: pdas.poolState.toBase58()
      };
    }

    // Fall back to Phantom wallet signing
    if (!window.solana?.isPhantom) {
      throw new Error('Phantom wallet not available. Enable auto-sign or install Phantom.');
    }

    const { signature } = await window.solana.signAndSendTransaction(transaction);
    console.log('[ACL] Bonk transaction sent via Phantom, signature:', signature);

    return {
      success: true,
      signature: signature,
      mintAddress: mintKeypair.publicKey.toBase58(),
      metadataUri: ipfsResult.metadataUri,
      poolState: pdas.poolState.toBase58()
    };
  }

  // ==================== BAGS.FM LAUNCH ====================

  async function uploadToBagsIPFS(metadata, imageBlob) {
    const formData = new FormData();

    if (imageBlob) {
      const ext = imageBlob.type?.split('/')[1] || 'png';
      formData.append('image', imageBlob, `token.${ext}`);
    }

    formData.append('name', metadata.name);
    formData.append('symbol', metadata.ticker);
    // Bags requires non-empty description (min 1 char)
    const desc = (metadata.description || '').trim();
    formData.append('description', desc.length > 0 ? desc : `${metadata.name} token`);
    if (metadata.twitter) formData.append('twitter', metadata.twitter);
    if (metadata.telegram) formData.append('telegram', metadata.telegram);
    if (metadata.website) formData.append('website', metadata.website);

    const response = await proxyFetch(PLATFORMS.bags.tokenInfo, {
      method: 'POST',
      headers: {
        'x-api-key': BAGS_API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      console.error('[ACL] Bags token info error:', response.data);
      throw new Error(`Bags token info upload failed: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    console.log('[ACL] Bags token info response:', response.data);
    return response.data;
  }

  async function createBagsTransaction(publicKey, ipfsUri, mintPublicKey, buyAmountLamports, feeRecipients = []) {
    const payload = {
      ipfs: ipfsUri,
      tokenMint: mintPublicKey,
      wallet: publicKey,
      initialBuyLamports: buyAmountLamports
    };

    // Add fee recipients if configured
    if (feeRecipients.length > 0) {
      payload.feeClaimers = feeRecipients.map(r => {
        const claimer = { bps: r.bps };
        if (r.identity) {
          claimer.identity = r.identity;
        } else {
          claimer.address = r.address;
        }
        return claimer;
      });
    }

    console.log('[ACL] Bags transaction payload:', JSON.stringify(payload, null, 2));

    const response = await proxyFetch(PLATFORMS.bags.launchTx, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': BAGS_API_KEY
      },
      body: JSON.stringify(payload),
      responseType: 'arraybuffer'
    });

    if (!response.ok) {
      let errorMsg = '';
      if (response.data && Array.isArray(response.data)) {
        errorMsg = String.fromCharCode(...response.data);
      } else if (typeof response.data === 'string') {
        errorMsg = response.data;
      }
      console.error('[ACL] Bags transaction error:', errorMsg);
      throw new Error(`Bags transaction creation failed: ${response.status} - ${errorMsg}`);
    }

    return new Uint8Array(response.data);
  }

  async function executeBagsLaunch(launchData) {
    const { name, ticker, description, twitter, telegram, website, imageUrl, buyAmount } = launchData;

    // Pre-load Solana Web3
    const web3 = await loadSolanaWeb3();

    // Step 1: Use custom image or download from URL
    let imageBlob;
    if (customImageBlob) {
      showStatus('Using custom image...', 'info');
      imageBlob = customImageBlob;
    } else {
      showStatus('Downloading image...', 'info');
      imageBlob = await downloadImage(imageUrl);
    }

    // Convert WebP to PNG if needed (Bags may not accept WebP)
    if (imageBlob && imageBlob.type === 'image/webp') {
      console.log('[ACL] Converting WebP to PNG for Bags upload...');
      imageBlob = await convertToPng(imageBlob);
    }

    // Step 2: Upload token info to Bags
    showStatus('Uploading to Bags.fm...', 'info');
    const tokenInfo = await uploadToBagsIPFS({
      name, ticker, description, twitter, telegram, website
    }, imageBlob);

    // Bags API response: { success: true, response: { tokenMint, tokenMetadata, tokenLaunch } }
    const bagsResponse = tokenInfo.response || tokenInfo;
    const ipfsUri = bagsResponse.tokenMetadata || bagsResponse.metadataUri || bagsResponse.uri || tokenInfo.ipfs;
    const bagsMint = bagsResponse.tokenMint;

    if (!ipfsUri) {
      console.error('[ACL] Bags response missing IPFS URI:', tokenInfo);
      throw new Error('Failed to get IPFS URI from Bags. Check API response format.');
    }

    console.log('[ACL] Bags token info complete. URI:', ipfsUri, 'Mint:', bagsMint);

    // Step 3: Check wallet
    if (!walletState.fullAddress) {
      throw new Error('Wallet not connected');
    }

    const payerPubkey = new web3.PublicKey(walletState.fullAddress);

    // Step 4: Use mint from Bags API or generate locally
    showStatus('Preparing token mint...', 'info');
    let mintKeypair = null;
    let mintPublicKey;

    if (bagsMint) {
      mintPublicKey = bagsMint;
      console.log('[ACL] Using Bags-provided mint:', mintPublicKey);
    } else {
      mintKeypair = web3.Keypair.generate();
      mintPublicKey = mintKeypair.publicKey.toBase58();
      console.log('[ACL] Generated local mint:', mintPublicKey);
    }

    // Step 5: Create transaction via Bags API
    showStatus('Creating Bags transaction...', 'info');
    const buyAmountLamports = Math.floor((buyAmount || 0) * 1e9);
    const feeRecipients = getValidFeeRecipients();
    const txBytes = await createBagsTransaction(
      walletState.fullAddress,
      ipfsUri,
      mintPublicKey,
      buyAmountLamports,
      feeRecipients
    );

    // Step 6: Deserialize and sign
    showStatus('Please approve in wallet...', 'info');
    const transaction = web3.VersionedTransaction.deserialize(txBytes);

    // Only sign with mint keypair if we generated it locally
    if (mintKeypair) {
      transaction.sign([mintKeypair]);
      console.log('[ACL] Transaction signed with local mint keypair');
    } else {
      console.log('[ACL] Using Bags-managed mint, no local signing needed');
    }

    // Check if auto-sign is enabled
    if (autosignEnabled && storedPrivateKey) {
      console.log('[ACL] Using auto-sign mode for Bags launch');

      const bs58 = {
        decode: (str) => {
          const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
          const bytes = [];
          for (let i = 0; i < str.length; i++) {
            let carry = ALPHABET.indexOf(str[i]);
            if (carry < 0) throw new Error('Invalid base58 character');
            for (let j = 0; j < bytes.length; j++) {
              carry += bytes[j] * 58;
              bytes[j] = carry & 0xff;
              carry >>= 8;
            }
            while (carry > 0) {
              bytes.push(carry & 0xff);
              carry >>= 8;
            }
          }
          for (let i = 0; i < str.length && str[i] === '1'; i++) {
            bytes.push(0);
          }
          return new Uint8Array(bytes.reverse());
        }
      };

      const secretKeyBytes = bs58.decode(storedPrivateKey);
      const walletKeypair = web3.Keypair.fromSecretKey(secretKeyBytes);

      // Sign with wallet keypair
      transaction.sign([walletKeypair]);
      console.log('[ACL] Transaction signed with wallet keypair (auto-sign)');

      // Send the transaction via proxy
      const signature = await sendRawTransactionProxy(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });

      console.log('[ACL] Bags transaction sent, signature:', signature);

      return {
        success: true,
        signature: signature,
        mintAddress: mintKeypair.publicKey.toBase58(),
        metadataUri: ipfsUri
      };
    }

    // Fall back to Phantom wallet signing
    if (!window.solana?.isPhantom) {
      throw new Error('Phantom wallet not available. Enable auto-sign or install Phantom.');
    }

    const { signature } = await window.solana.signAndSendTransaction(transaction);
    console.log('[ACL] Bags transaction sent via Phantom, signature:', signature);

    return {
      success: true,
      signature: signature,
      mintAddress: mintKeypair.publicKey.toBase58(),
      metadataUri: ipfsUri
    };
  }

  // Panel state
  let panel = null;
  let isDocked = false;
  let currentToken = null;
  let walletState = { connected: false, address: null, type: null };
  let selectedPlatform = 'pump';
  const BAGS_API_KEY = 'bags_prod_f8CLSWq1Y51oi1V7xsUb_2XDj4unbXdnkxfdRQNcNBo';
  let panelWidth = 288;

  // Custom image state
  let customImageBlob = null;
  let originalImageUrl = null;

  // Bags fee recipients (array of {address, bps})
  let bagsFeeRecipients = [];

  // AI settings
  let aiProvider = 'anthropic';
  let aiApiKey = '';
  let geminiImageKey = '';

  // RPC settings
  let rpcConfig = { type: 'free', url: 'https://api.mainnet-beta.solana.com' };

  // Opposite token fallback dictionary - comprehensive word mappings
  const OPPOSITE_FALLBACKS = {
    // Colors
    'black': 'white', 'white': 'black', 'red': 'blue', 'blue': 'red',
    'gold': 'silver', 'silver': 'gold', 'golden': 'silver', 'bright': 'dim', 'dim': 'bright',
    'dark': 'light', 'light': 'dark', 'pink': 'green', 'green': 'red',
    // Animals - ordered by specificity
    'wolf': 'sheep', 'sheep': 'wolf', 'lion': 'lamb', 'lamb': 'lion',
    'cat': 'dog', 'dog': 'cat', 'eagle': 'snake', 'snake': 'eagle',
    'fox': 'rabbit', 'rabbit': 'fox', 'hawk': 'dove', 'dove': 'hawk',
    'bull': 'bear', 'bear': 'bull', 'whale': 'shrimp', 'shrimp': 'whale',
    'tiger': 'deer', 'deer': 'tiger', 'crow': 'swan', 'swan': 'crow',
    'owl': 'rooster', 'rooster': 'owl', 'frog': 'toad', 'toad': 'frog',
    'ape': 'sloth', 'sloth': 'ape', 'monkey': 'sloth',
    // Direction/Position
    'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left',
    'top': 'bottom', 'bottom': 'top', 'high': 'low', 'low': 'high',
    'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east',
    'first': 'last', 'last': 'first', 'front': 'back', 'back': 'front',
    // Trading/Crypto
    'buy': 'sell', 'sell': 'buy', 'long': 'short',
    'pump': 'fade', 'moon': 'earth', 'earth': 'moon',
    'diamond': 'paper', 'paper': 'diamond', 'degen': 'normie', 'normie': 'degen',
    'alpha': 'omega', 'omega': 'alpha', 'beta': 'alpha',
    'wagmi': 'ngmi', 'ngmi': 'wagmi', 'hodl': 'sell',
    // Size
    'big': 'small', 'small': 'big', 'large': 'tiny', 'tiny': 'large',
    'giant': 'dwarf', 'dwarf': 'giant', 'mega': 'micro', 'micro': 'mega',
    'fat': 'skinny', 'skinny': 'fat', 'tall': 'short', 'thick': 'thin', 'thin': 'thick',
    // Speed/Time
    'fast': 'slow', 'slow': 'fast', 'quick': 'lazy', 'lazy': 'quick',
    'day': 'night', 'night': 'day', 'sun': 'moon',
    'old': 'young', 'young': 'old', 'ancient': 'modern', 'modern': 'ancient',
    // Emotions/States
    'happy': 'sad', 'sad': 'happy', 'good': 'bad', 'bad': 'good',
    'love': 'hate', 'hate': 'love', 'hot': 'cold', 'cold': 'hot',
    'rich': 'poor', 'poor': 'rich', 'win': 'lose', 'lose': 'win',
    'based': 'cringe', 'cringe': 'based', 'chad': 'virgin', 'virgin': 'chad',
    'smart': 'dumb', 'dumb': 'smart', 'brave': 'scared', 'scared': 'brave',
    'strong': 'weak', 'weak': 'strong', 'alive': 'dead', 'dead': 'alive',
    'real': 'fake', 'fake': 'real', 'true': 'false', 'false': 'true',
    'nice': 'mean', 'mean': 'nice', 'wild': 'tame', 'tame': 'wild',
    'mad': 'sane', 'sane': 'mad', 'crazy': 'calm', 'calm': 'wild',
    // Nature/Elements
    'fire': 'water', 'water': 'fire', 'ice': 'fire',
    'yin': 'yang', 'yang': 'yin', 'sky': 'ground', 'ground': 'sky',
    'sea': 'land', 'land': 'sea', 'ocean': 'desert', 'desert': 'ocean',
    'mountain': 'valley', 'valley': 'mountain', 'summer': 'winter', 'winter': 'summer',
    'storm': 'calm', 'rain': 'sun', 'snow': 'sand', 'sand': 'snow',
    // Characters/Archetypes
    'king': 'peasant', 'peasant': 'king', 'queen': 'servant', 'servant': 'queen',
    'hero': 'villain', 'villain': 'hero', 'angel': 'demon', 'demon': 'angel',
    'god': 'mortal', 'mortal': 'god', 'master': 'servant',
    'lord': 'servant', 'knight': 'peasant', 'prince': 'pauper', 'pauper': 'prince',
    'saint': 'sinner', 'sinner': 'saint', 'wizard': 'muggle', 'muggle': 'wizard',
    // Meme-specific
    'pepe': 'wojak', 'wojak': 'pepe', 'doge': 'cate', 'cate': 'doge',
    'bonk': 'boop', 'boop': 'bonk', 'gm': 'gn', 'gn': 'gm',
    // Prefixes
    'super': 'sub', 'sub': 'super', 'pro': 'noob', 'noob': 'pro',
    'max': 'min', 'min': 'max', 'ultra': 'basic', 'basic': 'ultra'
  };

  /**
   * Find Axiom's panel container - works even without other panels open
   */
  function findAxiomPanelContainer() {
    console.log('[ACL Panel] Searching for Axiom panel container...');

    // Strategy 1: Find existing Axiom panels via their draggable icons
    const dragIcons = document.querySelectorAll('i.ri-draggable');
    console.log('[ACL Panel] Found ri-draggable icons:', dragIcons.length);

    for (const icon of dragIcons) {
      // Skip our own panel
      if (icon.closest('#acl-panel')) continue;

      // Axiom structure: icon -> span.contents -> div.cursor-move (header) -> div.flex-col (panel) -> div.flex-row (container)
      let el = icon;

      // Go up to find the header (has cursor-move and h-[44px])
      for (let i = 0; i < 3; i++) {
        el = el.parentElement;
        if (!el) break;
        if (el.className.includes('cursor-move')) {
          console.log('[ACL Panel] Found Axiom header:', el.className.substring(0, 80));

          // Header's parent is the panel (flex-col)
          const panelEl = el.parentElement;
          if (panelEl && panelEl.className.includes('flex-col')) {
            console.log('[ACL Panel] Found Axiom panel:', panelEl.className.substring(0, 80));

            // Panel's parent is the container (flex-row)
            const container = panelEl.parentElement;
            if (container && container.className.includes('flex-row')) {
              console.log('[ACL Panel] Found Axiom container via existing panel');
              return { container, insertBefore: panelEl };
            }
          }
          break;
        }
      }
    }

    // Strategy 2: Find the persistent container that exists even without panels
    // This is .h-screen-safe > child[2] which is "relative flex min-h-0 flex-1 flex-row overflow-hidden"
    const screenSafe = document.querySelector('.h-screen-safe');
    if (screenSafe && screenSafe.children.length >= 3) {
      const persistentContainer = screenSafe.children[2];
      if (persistentContainer && persistentContainer.className.includes('flex-row')) {
        console.log('[ACL Panel] Found persistent container:', persistentContainer.className.substring(0, 80));
        // Insert directly into the persistent container at the start
        return { container: persistentContainer, insertBefore: persistentContainer.firstChild };
      }
    }

    console.log('[ACL Panel] No Axiom container found');
    return null;
  }

  /**
   * Create panel with Axiom's exact structure
   */
  function createPanel() {
    console.log('[ACL Panel] createPanel called');

    if (document.getElementById(PANEL_ID)) {
      panel = document.getElementById(PANEL_ID);
      return;
    }

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Try to dock into Axiom's panel system
    const result = findAxiomPanelContainer();

    if (result && result.container) {
      console.log('[ACL Panel] Docking into Axiom container');
      isDocked = true;

      // Match Axiom's exact panel structure: flex min-h-[0px] flex-col overflow-hidden bg-backgroundSecondary
      panel.className = 'flex min-h-[0px] flex-col overflow-hidden bg-backgroundSecondary opacity-100';
      panel.style.cssText = `
        width: 288px;
        min-width: 200px;
        max-width: 400px;
        border-right: 1px solid var(--primaryStroke, rgba(255,255,255,0.1));
        flex-shrink: 0;
      `;

      panel.innerHTML = getDockedPanelHTML();

      // Insert into container
      if (result.insertBefore) {
        result.container.insertBefore(panel, result.insertBefore);
      } else {
        result.container.insertBefore(panel, result.container.firstChild);
      }

      // Setup resize via the right border (drag to resize)
      setupDockedResizeHandler(panel);
      console.log('[ACL Panel] Successfully docked');

    } else {
      console.log('[ACL Panel] Using floating mode');
      isDocked = false;
      panel.className = 'acl-floating-panel';
      panel.innerHTML = getFloatingPanelHTML();
      document.body.appendChild(panel);
      loadPosition();
      setupFloatingDragHandlers();
      setupFloatingResizeHandler();
    }

    setupPanelEvents();
    loadTokenData();
  }

  /**
   * Docked panel HTML - matches Axiom's exact structure
   * Header: h-[44px] min-h-[44px] cursor-move select-none items-center justify-between gap-[16px] border-b border-primaryStroke
   */
  function getDockedPanelHTML() {
    return `
      <div class="relative flex h-[44px] min-h-[44px] cursor-move select-none items-center justify-between gap-[16px] border-b border-primaryStroke px-[12px]">
        <div class="flex items-center gap-[8px]">
          <span class="contents">
            <i class="ri-draggable text-[14px] text-tertiaryText transition-colors" style="transform: rotate(90deg);"></i>
          </span>
          <span class="text-[12px] font-medium text-primaryText whitespace-nowrap">Beta Launch</span>
        </div>
        <div class="flex items-center gap-[8px]">
          <button class="acl-btn-icon flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-tertiaryText hover:bg-white/10 hover:text-primaryText transition-colors" title="Settings">
            <i class="ri-settings-3-line text-[14px]"></i>
          </button>
          <button class="acl-btn-icon close flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-tertiaryText hover:bg-white/10 hover:text-primaryText transition-colors" title="Close">
            <i class="ri-close-line text-[14px]"></i>
          </button>
        </div>
      </div>

      <div class="acl-body flex-1 overflow-y-auto p-[12px]">
        ${getFormHTML()}
      </div>
    `;
  }

  /**
   * Floating panel HTML (fallback)
   */
  function getFloatingPanelHTML() {
    return `
      <div class="acl-header relative flex h-[44px] min-h-[44px] cursor-move select-none items-center justify-between gap-[16px] border-b border-white/10 px-[12px]" style="background: #0d0d0f;">
        <div class="flex items-center gap-[8px]">
          <i class="ri-draggable text-[14px] text-white/40" style="transform: rotate(90deg);"></i>
          <span class="text-[12px] font-medium text-white whitespace-nowrap">Beta Launch</span>
        </div>
        <div class="flex items-center gap-[8px]">
          <button class="acl-btn-icon close flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-white/40 hover:bg-white/10 hover:text-white transition-colors" title="Close">
            <i class="ri-close-line text-[14px]"></i>
          </button>
        </div>
      </div>

      <div class="acl-body flex-1 overflow-y-auto p-[12px]" style="background: #0d0d0f;">
        ${getFormHTML()}
      </div>
    `;
  }

  /**
   * Form HTML shared between modes
   */
  function getFormHTML() {
    return `
      <div class="flex flex-col gap-[12px]">
        <!-- Tips Banner -->
        <div class="flex items-center justify-center gap-[8px] rounded-[6px] bg-white/5 px-[8px] py-[6px] text-[9px] text-white/50">
          <span class="flex items-center gap-[2px]"><kbd class="rounded bg-white/10 px-[3px] py-[1px] text-[8px]">Ctrl</kbd>clone</span>
          <span class="text-white/20">•</span>
          <span class="flex items-center gap-[2px]"><kbd class="rounded bg-white/10 px-[3px] py-[1px] text-[8px]">Alt</kbd>flip</span>
          <span class="text-white/20">•</span>
          <span class="flex items-center gap-[2px]"><kbd class="rounded bg-white/10 px-[3px] py-[1px] text-[8px]">Alt+⇧</kbd>beta</span>
        </div>

        <!-- Wallet Section (Compact) -->
        <div class="flex items-center gap-[8px] rounded-[6px] border border-white/10 bg-white/5 p-[8px]" id="acl-wallet-section">
          <div class="acl-wallet-status flex items-center gap-[6px] flex-1 min-w-0" id="acl-wallet-status">
            <span class="acl-status-dot h-[6px] w-[6px] rounded-full bg-red-500 flex-shrink-0"></span>
            <span class="acl-status-text text-[11px] text-white/60 truncate">Not Connected</span>
            <span class="acl-balance text-[11px] text-white/40 ml-auto flex-shrink-0" id="acl-wallet-balance" style="display: none;"></span>
          </div>
          <button class="rounded-[4px] border border-white/10 bg-white/5 px-[8px] py-[4px] text-[10px] font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors flex-shrink-0" id="acl-connect-btn">
            Connect
          </button>
        </div>
        <div class="acl-wallet-options flex-col gap-[4px]" id="acl-wallet-options" style="display: none;">
          <button class="acl-wallet-option flex items-center gap-[8px] rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white hover:border-green-500/50 hover:bg-green-500/10 transition-colors" data-wallet="phantom">
            <svg width="16" height="16" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" rx="26" fill="#AB9FF2"/><path d="M110.584 64.914H99.142C99.142 41.765 80.173 23 56.772 23C33.661 23 14.872 41.306 14.417 64.058C13.95 87.368 35.889 107 59.25 107H63.437C83.621 107 103.488 93.576 110.17 74.196C111.426 70.699 111.926 67.133 110.584 64.914ZM40.244 66.291C40.244 69.138 37.922 71.445 35.058 71.445C32.195 71.445 29.873 69.138 29.873 66.291V58.445C29.873 55.599 32.195 53.291 35.058 53.291C37.922 53.291 40.244 55.599 40.244 58.445V66.291ZM59.917 66.291C59.917 69.138 57.596 71.445 54.732 71.445C51.868 71.445 49.546 69.138 49.546 66.291V58.445C49.546 55.599 51.868 53.291 54.732 53.291C57.596 53.291 59.917 55.599 59.917 58.445V66.291Z" fill="#FFFDF8"/></svg>
            Phantom
          </button>
          <button class="acl-wallet-option flex items-center gap-[8px] rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white hover:border-green-500/50 hover:bg-green-500/10 transition-colors" data-wallet="solflare">
            <svg width="16" height="16" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="32" fill="url(#sf-grad)"/><path d="M32 12L44 24L32 36L20 24L32 12Z" fill="white"/><path d="M32 28L44 40L32 52L20 40L32 28Z" fill="white" fill-opacity="0.6"/><defs><linearGradient id="sf-grad" x1="0" y1="0" x2="64" y2="64"><stop stop-color="#FCC00A"/><stop offset="1" stop-color="#FC7B23"/></linearGradient></defs></svg>
            Solflare
          </button>
          <button class="acl-wallet-option flex items-center gap-[8px] rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white hover:border-green-500/50 hover:bg-green-500/10 transition-colors" data-wallet="burner">
            🔥 Burner Wallet
          </button>
        </div>

        <!-- Platform Selector -->
        <div class="flex flex-col gap-[6px]">
          <label class="text-[10px] font-medium uppercase tracking-wider text-white/40">Launch Platform</label>
          <div class="flex gap-[6px]" id="acl-platform-options">
            <button type="button" class="acl-platform-btn active flex-1 flex flex-col items-center gap-[4px] rounded-[6px] border border-green-500/50 bg-green-500/10 p-[8px] text-white transition-colors" data-platform="pump">
              <img class="h-[20px] w-[20px] rounded object-contain" src="https://axiom.trade/images/pump.svg" alt="">
              <span class="text-[10px] font-medium">Pump.fun</span>
            </button>
            <button type="button" class="acl-platform-btn flex-1 flex flex-col items-center gap-[4px] rounded-[6px] border border-white/10 bg-white/5 p-[8px] text-white/60 hover:text-white hover:border-white/20 transition-colors" data-platform="bonk">
              <img class="h-[20px] w-[20px] rounded object-contain" src="https://axiom.trade/images/bonk.svg" alt="">
              <span class="text-[10px] font-medium">Bonk</span>
            </button>
            <button type="button" class="acl-platform-btn flex-1 flex flex-col items-center gap-[4px] rounded-[6px] border border-white/10 bg-white/5 p-[8px] text-white/60 hover:text-white hover:border-white/20 transition-colors" data-platform="bags">
              <img class="h-[20px] w-[20px] rounded object-contain" src="https://axiom.trade/images/bags.svg" alt="">
              <span class="text-[10px] font-medium">Bags</span>
            </button>
          </div>
        </div>

        <!-- Bags Fee Earners (hidden by default) -->
        <div class="flex flex-col gap-[8px]" id="acl-bags-fees-group" style="display: none;">
          <div class="flex items-center justify-between">
            <label class="text-[11px] font-medium text-white/70">Fee Earners</label>
            <span class="text-[10px] text-white/50" id="acl-fees-total">Total: 0%</span>
          </div>
          <div class="flex flex-col gap-[8px]" id="acl-fees-list">
            <!-- Fee earner cards added dynamically -->
          </div>
          <button type="button" class="flex items-center justify-center gap-[6px] rounded-[8px] border border-dashed border-white/20 py-[10px] text-[11px] text-white/50 hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-white/70 transition-all" id="acl-add-fee-btn">
            <span class="text-[14px]">+</span> Add Fee Earner
          </button>
        </div>

        <!-- Token Preview -->
        <div class="flex flex-col gap-[8px] rounded-[6px] border border-white/10 bg-white/5 p-[10px]">
          <div class="flex items-center gap-[10px]">
            <div class="acl-token-image flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/10 bg-white/5" id="acl-token-image">
              <span class="placeholder text-[9px] text-white/30 text-center p-[4px]">No token</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="acl-token-name text-[13px] font-semibold text-white truncate" id="acl-token-name">Select a token</div>
              <div class="acl-token-ticker text-[11px] font-medium text-green-400" id="acl-token-ticker">$---</div>
              <div class="acl-token-ca text-[10px] font-mono text-white/30 truncate mt-[2px]" id="acl-token-ca">Click any token to clone</div>
            </div>
          </div>

          <!-- Image Drop Zone -->
          <div id="acl-image-dropzone" class="acl-dropzone flex flex-col items-center justify-center gap-[4px] rounded-[6px] border-2 border-dashed border-white/20 p-[12px] cursor-pointer transition-colors hover:border-green-500/50 hover:bg-green-500/5">
            <input type="file" id="acl-image-input" accept="image/*" class="acl-hidden">
            <span class="text-[10px] text-white/50">Drop image or click to upload</span>
          </div>
          <button id="acl-reset-image" class="acl-hidden text-[10px] text-white/40 hover:text-white transition-colors" type="button">↺ Reset to original image</button>
        </div>

        <!-- Launch Form -->
        <form class="flex flex-col gap-[10px]" id="acl-form">
          <div class="flex flex-col gap-[4px]">
            <label class="text-[10px] font-medium text-white/60">Token Name</label>
            <input type="text" id="acl-name" placeholder="Enter token name" required class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white placeholder-white/30 focus:border-green-500/50 focus:outline-none transition-colors">
          </div>

          <div class="flex flex-col gap-[4px]">
            <label class="text-[10px] font-medium text-white/60">Ticker / Symbol</label>
            <input type="text" id="acl-ticker" placeholder="e.g. PEPE" required class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white placeholder-white/30 focus:border-green-500/50 focus:outline-none transition-colors">
          </div>

          <div class="flex flex-col gap-[4px]">
            <label class="text-[10px] font-medium text-white/60">Description</label>
            <textarea id="acl-description" placeholder="Token description" rows="2" class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white placeholder-white/30 focus:border-green-500/50 focus:outline-none transition-colors resize-y min-h-[50px]"></textarea>
          </div>

          <!-- Collapsible Social Links -->
          <div class="acl-collapsible rounded-[6px] border border-white/10 bg-white/5 overflow-hidden" id="acl-social-section">
            <div class="acl-collapsible-header flex cursor-pointer items-center justify-between px-[10px] py-[8px] text-[11px] text-white/60 hover:text-white transition-colors">
              <span>Social Links (Optional)</span>
              <span class="arrow text-[10px] transition-transform">▼</span>
            </div>
            <div class="acl-collapsible-content flex-col gap-[8px] px-[10px] pb-[10px]" style="display: none;">
              <div class="flex flex-col gap-[4px]">
                <label class="text-[10px] font-medium text-white/60">Twitter</label>
                <input type="url" id="acl-twitter" placeholder="https://twitter.com/..." class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white placeholder-white/30 focus:border-green-500/50 focus:outline-none transition-colors">
              </div>
              <div class="flex flex-col gap-[4px]">
                <label class="text-[10px] font-medium text-white/60">Telegram</label>
                <input type="url" id="acl-telegram" placeholder="https://t.me/..." class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white placeholder-white/30 focus:border-green-500/50 focus:outline-none transition-colors">
              </div>
              <div class="flex flex-col gap-[4px]">
                <label class="text-[10px] font-medium text-white/60">Website</label>
                <input type="url" id="acl-website" placeholder="https://..." class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white placeholder-white/30 focus:border-green-500/50 focus:outline-none transition-colors">
              </div>
            </div>
          </div>

          <!-- Launch Settings -->
          <div class="flex gap-[10px]">
            <div class="flex-1 flex flex-col gap-[4px]">
              <label class="text-[10px] font-medium text-white/60">Initial Buy (SOL)</label>
              <input type="number" id="acl-buy-amount" value="0.1" min="0" step="0.01" class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white focus:border-green-500/50 focus:outline-none transition-colors">
            </div>
            <div class="flex-1 flex flex-col gap-[4px]">
              <label class="text-[10px] font-medium text-white/60">Slippage %</label>
              <input type="number" id="acl-slippage" value="10" min="1" max="50" class="w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[12px] text-white focus:border-green-500/50 focus:outline-none transition-colors">
            </div>
          </div>

          <!-- Launch Button -->
          <button type="submit" class="acl-btn-primary w-full rounded-[8px] bg-gradient-to-r from-green-500 to-green-600 px-[14px] py-[10px] text-[12px] font-semibold text-black disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-green-500/20 transition-all" id="acl-launch-btn" disabled>
            <span class="btn-text" id="acl-launch-btn-text">Launch on Pump.fun</span>
            <span class="btn-loader items-center gap-[6px]" style="display: none;">
              <span class="acl-spinner h-[14px] w-[14px] animate-spin rounded-full border-2 border-transparent border-t-current"></span>
              Launching...
            </span>
          </button>
        </form>

        <!-- Status -->
        <div class="acl-status rounded-[6px] px-[10px] py-[8px] text-[11px]" id="acl-status" style="display: none;"></div>

        <!-- Footer Credit -->
        <div class="flex flex-col items-center gap-[4px] pt-[8px] border-t border-white/10 mt-[4px]">
          <span class="text-[9px] text-white/40">Created by <a href="https://twitter.com/kaelxsol" target="_blank" rel="noopener" class="text-white/60 hover:text-green-400 transition-colors">@kaelxsol</a></span>
          <a href="https://axiom.trade/meme/2rYj8nHynSmubF2hb7j7m5ovm3CGyymoEzKkf5fepump" target="_blank" rel="noopener" class="text-[10px] font-semibold text-green-400 hover:text-green-300 transition-colors">$beta</a>
        </div>
      </div>
    `;
  }

  /**
   * Setup resize handler for docked panel (drag right edge to resize)
   */
  function setupDockedResizeHandler(panelEl) {
    if (!panelEl) return;

    let startX, startWidth, isResizing = false;

    panelEl.addEventListener('mousemove', (e) => {
      const rect = panelEl.getBoundingClientRect();
      const nearEdge = e.clientX > rect.right - 6;
      panelEl.style.cursor = nearEdge ? 'ew-resize' : '';
    });

    panelEl.addEventListener('mouseleave', () => {
      if (!isResizing) panelEl.style.cursor = '';
    });

    panelEl.addEventListener('mousedown', (e) => {
      const rect = panelEl.getBoundingClientRect();
      if (e.clientX <= rect.right - 6) return;

      isResizing = true;
      startX = e.clientX;
      startWidth = panelEl.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      const onMove = (e) => {
        const delta = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(400, startWidth + delta));
        panelEl.style.width = newWidth + 'px';
        panelWidth = newWidth;
      };

      const onUp = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        panelEl.style.cursor = '';
        saveState();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /**
   * Setup drag handlers for floating panel
   */
  function setupFloatingDragHandlers() {
    const header = panel.querySelector('.acl-header');
    if (!header) return;

    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    const startDrag = (e) => {
      if (e.target.closest('.acl-btn-icon')) return;
      isDragging = true;
      panel.classList.add('dragging');

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = panel.getBoundingClientRect();

      dragOffset.x = clientX - rect.left;
      dragOffset.y = clientY - rect.top;

      if (e.touches) e.preventDefault();
    };

    const onDrag = (e) => {
      if (!isDragging) return;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      let newX = clientX - dragOffset.x;
      let newY = clientY - dragOffset.y;

      const rect = panel.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      if (e.touches) e.preventDefault();
    };

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      panel.classList.remove('dragging');
      saveState();
    };

    header.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
  }

  /**
   * Setup resize handler for floating panel
   */
  function setupFloatingResizeHandler() {
    // Floating panel uses CSS resize or no resize
  }

  /**
   * Setup panel UI events
   */
  function setupPanelEvents() {
    // Close button
    const closeBtn = panel.querySelector('.acl-btn-icon.close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hidePanel);
    }

    // Wallet connect
    const connectBtn = panel.querySelector('#acl-connect-btn');
    const walletOptions = panel.querySelector('#acl-wallet-options');

    if (connectBtn && walletOptions) {
      connectBtn.addEventListener('click', () => {
        walletOptions.style.display = walletOptions.style.display === 'none' ? 'flex' : 'none';
      });
    }

    panel.querySelectorAll('.acl-wallet-option').forEach(btn => {
      btn.addEventListener('click', () => handleWalletConnect(btn.dataset.wallet));
    });

    // Platform selection
    panel.querySelectorAll('.acl-platform-btn').forEach(btn => {
      btn.addEventListener('click', () => handlePlatformSelect(btn.dataset.platform));
    });

    // Collapsible sections
    panel.querySelectorAll('.acl-collapsible-header').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const arrow = header.querySelector('.arrow');
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'flex' : 'none';
        if (arrow) {
          arrow.style.transform = isHidden ? 'rotate(180deg)' : '';
        }
      });
    });

    // Form submission
    const form = panel.querySelector('#acl-form');
    if (form) {
      form.addEventListener('submit', handleLaunch);
    }

    // Form validation
    ['#acl-name', '#acl-ticker'].forEach(sel => {
      const el = panel.querySelector(sel);
      if (el) el.addEventListener('input', updateLaunchButton);
    });

    // Settings button
    const settingsBtn = panel.querySelector('.acl-btn-icon[title="Settings"]');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', showSettingsModal);
    }

    // Image dropzone
    setupImageDropzone();

    // Bags fee recipients
    setupBagsFeeRecipients();
  }

  /**
   * Setup Bags fee recipient handlers
   */
  function setupBagsFeeRecipients() {
    const addBtn = panel.querySelector('#acl-add-fee-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        addFeeRecipient();
      });
    }
  }

  /**
   * Add a new fee earner card
   */
  function addFeeRecipient(address = '', bps = 0, platform = 'wallet') {
    const list = panel.querySelector('#acl-fees-list');
    if (!list) return;

    const index = bagsFeeRecipients.length;
    const earnerNum = bagsFeeRecipients.filter(r => r !== null).length + 1;
    bagsFeeRecipients.push({ address: address, bps: parseInt(bps) || 0, platform: platform });

    const card = document.createElement('div');
    card.className = 'rounded-[8px] border border-white/10 bg-[#1a1a1f] overflow-hidden';
    card.dataset.feeIndex = index;

    const percentage = (bps / 100).toFixed(2);

    card.innerHTML = `
      <!-- Card Header -->
      <div class="flex items-center justify-between px-[12px] py-[10px] border-b border-white/10 bg-white/5">
        <span class="text-[12px] font-medium text-white">Fee Earner #${earnerNum}</span>
        <div class="flex items-center gap-[8px]">
          <button type="button" class="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-red-400/60 hover:bg-red-500/20 hover:text-red-400 transition-colors" data-fee-remove="${index}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>
          </button>
          <button type="button" class="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-white/40 hover:bg-white/10 hover:text-white transition-colors" data-fee-collapse="${index}" title="Collapse">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transition-transform" data-collapse-icon="${index}"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
        </div>
      </div>

      <!-- Card Body -->
      <div class="flex flex-col gap-[12px] p-[12px]" data-fee-body="${index}">
        <!-- Platform Tabs -->
        <div class="flex gap-[6px]">
          <button type="button" class="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] border transition-all ${platform === 'twitter' ? 'border-emerald-500 bg-emerald-500/20 text-white' : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white'}" data-fee-platform="${index}" data-platform="twitter" title="Twitter/X">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </button>
          <button type="button" class="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] border transition-all ${platform === 'github' ? 'border-emerald-500 bg-emerald-500/20 text-white' : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white'}" data-fee-platform="${index}" data-platform="github" title="GitHub">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          </button>
          <button type="button" class="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] border transition-all ${platform === 'wallet' ? 'border-emerald-500 bg-emerald-500/20 text-white' : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white'}" data-fee-platform="${index}" data-platform="wallet" title="Wallet Address">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M16 12h.01M12 12h.01M8 12h.01"/></svg>
          </button>
        </div>

        <!-- Input Field -->
        <input type="text" placeholder="${platform === 'wallet' ? 'Wallet address' : '@username'}" value="${address}"
          class="w-full rounded-[8px] border border-white/10 bg-white/5 px-[12px] py-[10px] text-[12px] text-white placeholder-white/30 focus:border-emerald-500/50 focus:outline-none transition-colors ${platform === 'wallet' ? 'font-mono' : ''}"
          data-fee-address="${index}">

        <!-- Fee Percentage -->
        <div class="flex flex-col gap-[8px]">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/50">Fee percentage</span>
            <span class="text-[11px] text-white/70" data-fee-display="${index}">${percentage}%</span>
          </div>
          <div class="flex gap-[6px]">
            <button type="button" class="flex-1 rounded-[6px] border border-white/10 bg-white/5 py-[6px] text-[10px] text-white/60 hover:border-white/20 hover:text-white transition-all ${bps === 100 ? 'border-emerald-500 bg-emerald-500/20 text-white' : ''}" data-fee-preset="${index}" data-bps="100">1%</button>
            <button type="button" class="flex-1 rounded-[6px] border border-white/10 bg-white/5 py-[6px] text-[10px] text-white/60 hover:border-white/20 hover:text-white transition-all ${bps === 1000 ? 'border-emerald-500 bg-emerald-500/20 text-white' : ''}" data-fee-preset="${index}" data-bps="1000">10%</button>
            <button type="button" class="flex-1 rounded-[6px] border border-white/10 bg-white/5 py-[6px] text-[10px] text-white/60 hover:border-white/20 hover:text-white transition-all ${bps === 5000 ? 'border-emerald-500 bg-emerald-500/20 text-white' : ''}" data-fee-preset="${index}" data-bps="5000">50%</button>
            <button type="button" class="flex-1 rounded-[6px] border border-white/10 bg-white/5 py-[6px] text-[10px] text-white/60 hover:border-white/20 hover:text-white transition-all ${bps === 10000 ? 'border-emerald-500 bg-emerald-500/20 text-white' : ''}" data-fee-preset="${index}" data-bps="10000">100%</button>
            <button type="button" class="flex-1 rounded-[6px] border border-white/10 bg-white/5 py-[6px] text-[10px] text-white/60 hover:border-white/20 hover:text-white transition-all" data-fee-custom="${index}">Custom</button>
          </div>
          <!-- Custom input (hidden by default) -->
          <input type="number" placeholder="Enter BPS (0-10000)" value="${bps || ''}" min="0" max="10000"
            class="hidden w-full rounded-[6px] border border-white/10 bg-white/5 px-[10px] py-[8px] text-[11px] text-white placeholder-white/30 focus:border-emerald-500/50 focus:outline-none transition-colors text-center"
            data-fee-bps="${index}">
        </div>
      </div>
    `;

    list.appendChild(card);
    setupFeeCardEvents(card, index);
    updateFeesTotal();
  }

  /**
   * Setup event listeners for a fee card
   */
  function setupFeeCardEvents(card, index) {
    // Address input
    const addrInput = card.querySelector(`[data-fee-address="${index}"]`);
    addrInput?.addEventListener('input', (e) => {
      bagsFeeRecipients[index].address = e.target.value.trim();
    });

    // BPS custom input
    const bpsInput = card.querySelector(`[data-fee-bps="${index}"]`);
    bpsInput?.addEventListener('input', (e) => {
      const bps = parseInt(e.target.value) || 0;
      bagsFeeRecipients[index].bps = Math.min(10000, Math.max(0, bps));
      updateFeeDisplay(index);
      updateFeesTotal();
      updatePresetButtons(card, index);
    });

    // Remove button
    const removeBtn = card.querySelector(`[data-fee-remove="${index}"]`);
    removeBtn?.addEventListener('click', () => removeFeeRecipient(index));

    // Collapse button
    const collapseBtn = card.querySelector(`[data-fee-collapse="${index}"]`);
    const body = card.querySelector(`[data-fee-body="${index}"]`);
    const icon = card.querySelector(`[data-collapse-icon="${index}"]`);
    collapseBtn?.addEventListener('click', () => {
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'flex' : 'none';
      icon.style.transform = isHidden ? '' : 'rotate(180deg)';
    });

    // Platform tabs
    card.querySelectorAll(`[data-fee-platform="${index}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        bagsFeeRecipients[index].platform = platform;
        // Update tab styles
        card.querySelectorAll(`[data-fee-platform="${index}"]`).forEach(b => {
          const isActive = b.dataset.platform === platform;
          b.className = b.className
            .replace(/border-emerald-500 bg-emerald-500\/20 text-white|border-white\/10 bg-white\/5 text-white\/50/g, '')
            .trim();
          b.classList.add(...(isActive
            ? ['border-emerald-500', 'bg-emerald-500/20', 'text-white']
            : ['border-white/10', 'bg-white/5', 'text-white/50']));
        });
        // Update placeholder
        addrInput.placeholder = platform === 'wallet' ? 'Wallet address' : '@username';
        addrInput.classList.toggle('font-mono', platform === 'wallet');
      });
    });

    // Preset buttons
    card.querySelectorAll(`[data-fee-preset="${index}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const bps = parseInt(btn.dataset.bps);
        bagsFeeRecipients[index].bps = bps;
        bpsInput.value = bps;
        bpsInput.classList.add('hidden');
        updateFeeDisplay(index);
        updateFeesTotal();
        updatePresetButtons(card, index);
      });
    });

    // Custom button
    const customBtn = card.querySelector(`[data-fee-custom="${index}"]`);
    customBtn?.addEventListener('click', () => {
      bpsInput.classList.remove('hidden');
      bpsInput.focus();
      updatePresetButtons(card, index);
    });
  }

  /**
   * Update fee display for a card
   */
  function updateFeeDisplay(index) {
    const display = panel.querySelector(`[data-fee-display="${index}"]`);
    if (display && bagsFeeRecipients[index]) {
      const percentage = (bagsFeeRecipients[index].bps / 100).toFixed(2);
      display.textContent = `${percentage}%`;
    }
  }

  /**
   * Update preset button styles
   */
  function updatePresetButtons(card, index) {
    const bps = bagsFeeRecipients[index]?.bps || 0;
    const presets = [100, 1000, 5000, 10000];
    card.querySelectorAll(`[data-fee-preset="${index}"]`).forEach(btn => {
      const presetBps = parseInt(btn.dataset.bps);
      const isActive = bps === presetBps;
      btn.className = btn.className
        .replace(/border-emerald-500 bg-emerald-500\/20 text-white|border-white\/10 bg-white\/5 text-white\/60/g, '')
        .trim();
      btn.classList.add(...(isActive
        ? ['border-emerald-500', 'bg-emerald-500/20', 'text-white']
        : ['border-white/10', 'bg-white/5', 'text-white/60']));
    });
  }

  /**
   * Remove a fee recipient
   */
  function removeFeeRecipient(index) {
    const list = panel.querySelector('#acl-fees-list');
    const card = list?.querySelector(`[data-fee-index="${index}"]`);
    if (card) {
      card.remove();
      bagsFeeRecipients[index] = null;
      updateFeesTotal();
    }
  }

  /**
   * Update the fees total display
   */
  function updateFeesTotal() {
    const totalEl = panel.querySelector('#acl-fees-total');
    if (!totalEl) return;

    const totalBps = bagsFeeRecipients
      .filter(r => r !== null)
      .reduce((sum, r) => sum + (r.bps || 0), 0);

    const percentage = (totalBps / 100).toFixed(0);
    const isValid = totalBps <= 10000;
    const isComplete = totalBps === 10000;

    totalEl.textContent = `Total: ${percentage}%`;
    totalEl.style.color = isComplete ? 'rgb(134 239 172)' : (isValid ? 'rgba(255,255,255,0.5)' : 'rgb(248 113 113)');
  }

  /**
   * Get valid fee recipients for API
   * Handles both wallet addresses and social identities
   */
  function getValidFeeRecipients() {
    return bagsFeeRecipients
      .filter(r => r !== null && r.address && r.bps > 0)
      .map(r => {
        // For social platforms, format as identity string
        if (r.platform === 'twitter') {
          return { identity: `twitter:${r.address.replace('@', '')}`, bps: r.bps };
        } else if (r.platform === 'github') {
          return { identity: `github:${r.address.replace('@', '')}`, bps: r.bps };
        }
        // Default: wallet address
        return { address: r.address, bps: r.bps };
      });
  }

  /**
   * Setup image dropzone handlers
   */
  function setupImageDropzone() {
    const dropzone = panel.querySelector('#acl-image-dropzone');
    const fileInput = panel.querySelector('#acl-image-input');
    const resetBtn = panel.querySelector('#acl-reset-image');

    if (!dropzone || !fileInput) return;

    // Click to upload
    dropzone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageFile(file);
    });

    // Drag events
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
      dropzone.style.borderColor = '#00ff88';
      dropzone.style.background = 'rgba(0, 255, 136, 0.1)';
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      dropzone.style.borderColor = '';
      dropzone.style.background = '';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      dropzone.style.borderColor = '';
      dropzone.style.background = '';

      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        handleImageFile(file);
      }
    });

    // Reset button
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        customImageBlob = null;
        resetBtn.classList.add('acl-hidden');
        // Restore original image
        if (originalImageUrl && currentToken) {
          currentToken.imageUrl = originalImageUrl;
          updateTokenImagePreview(originalImageUrl);
        }
        showStatus('Image reset to original', 'info');
      });
    }
  }

  /**
   * Handle uploaded/dropped image file
   */
  function handleImageFile(file) {
    customImageBlob = file;
    const resetBtn = panel.querySelector('#acl-reset-image');
    if (resetBtn) resetBtn.classList.remove('acl-hidden');

    // Update preview
    const reader = new FileReader();
    reader.onload = (e) => {
      updateTokenImagePreview(e.target.result);
    };
    reader.readAsDataURL(file);

    showStatus('Custom image set', 'success');
  }

  /**
   * Update token image preview
   */
  function updateTokenImagePreview(src) {
    const imageContainer = panel.querySelector('#acl-token-image');
    if (!imageContainer) return;

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.className = 'h-full w-full object-cover';
    img.onerror = () => {
      imageContainer.innerHTML = '<span class="text-[16px] font-bold text-white/60">?</span>';
    };
    imageContainer.innerHTML = '';
    imageContainer.appendChild(img);
  }

  /**
   * Handle platform selection
   */
  function handlePlatformSelect(platform) {
    console.log('[ACL Panel] Platform selected:', platform);
    selectedPlatform = platform;

    panel.querySelectorAll('.acl-platform-btn').forEach(btn => {
      const isActive = btn.dataset.platform === platform;
      btn.classList.toggle('active', isActive);

      if (isActive) {
        const color = PLATFORMS[platform].color;
        btn.className = btn.className
          .replace(/border-white\/10|border-green-500\/50|border-orange-500\/50|border-emerald-600\/50/g, '')
          .replace(/bg-white\/5|bg-green-500\/10|bg-orange-500\/10|bg-emerald-600\/10/g, '')
          .replace(/text-white\/60/g, 'text-white');

        if (platform === 'pump') {
          btn.classList.add('border-green-500/50', 'bg-green-500/10');
        } else if (platform === 'bonk') {
          btn.classList.add('border-orange-500/50', 'bg-orange-500/10');
        } else if (platform === 'bags') {
          // Dark green for Bags (was purple)
          btn.classList.add('border-emerald-600/50', 'bg-emerald-600/10');
        }
      } else {
        btn.className = btn.className
          .replace(/border-green-500\/50|border-orange-500\/50|border-emerald-600\/50/g, 'border-white/10')
          .replace(/bg-green-500\/10|bg-orange-500\/10|bg-emerald-600\/10/g, 'bg-white/5');
        if (!btn.classList.contains('text-white/60')) {
          btn.classList.remove('text-white');
          btn.classList.add('text-white/60');
        }
      }
    });

    // Update launch button
    const btnText = panel.querySelector('#acl-launch-btn-text');
    const launchBtn = panel.querySelector('#acl-launch-btn');

    if (btnText) {
      btnText.textContent = `Launch on ${PLATFORMS[platform].name}`;
    }

    if (launchBtn) {
      launchBtn.className = launchBtn.className
        .replace(/from-green-500 to-green-600|from-orange-500 to-orange-600|from-emerald-600 to-emerald-700/g, '');

      if (platform === 'pump') {
        launchBtn.classList.add('from-green-500', 'to-green-600');
      } else if (platform === 'bonk') {
        launchBtn.classList.add('from-orange-500', 'to-orange-600');
      } else if (platform === 'bags') {
        // Dark green for Bags (was purple)
        launchBtn.classList.add('from-emerald-600', 'to-emerald-700');
      }
    }

    // Show/hide Bags fee recipients section
    const bagsFeesGroup = panel.querySelector('#acl-bags-fees-group');
    if (bagsFeesGroup) {
      bagsFeesGroup.style.display = platform === 'bags' ? 'flex' : 'none';
    }

    window.postMessage({ type: 'ACL_SAVE_DATA', key: 'selectedPlatform', value: platform }, '*');
    updateLaunchButton();
  }

  /**
   * Handle wallet connection
   */
  async function handleWalletConnect(walletType) {
    showStatus('Connecting...', 'info');

    const walletOptions = panel.querySelector('#acl-wallet-options');
    if (walletOptions) walletOptions.style.display = 'none';

    try {
      if (walletType === 'burner') {
        const address = 'Burner' + Math.random().toString(36).substring(2, 8) + '...';
        walletState = { connected: true, address, type: 'burner' };
        showStatus('Burner wallet created!', 'success');

      } else if (walletType === 'phantom') {
        if (!window.solana?.isPhantom) {
          showStatus('Phantom wallet not found. Please install it.', 'error');
          return;
        }

        const response = await window.solana.connect();
        const publicKey = response.publicKey.toString();

        walletState = {
          connected: true,
          address: publicKey.substring(0, 4) + '...' + publicKey.slice(-4),
          fullAddress: publicKey,
          type: 'phantom'
        };
        showStatus('Phantom connected!', 'success');

        // Pre-load @solana/web3.js in background for faster launches
        loadSolanaWeb3().catch(e => console.warn('[ACL] Pre-load web3 failed:', e));

      } else if (walletType === 'solflare') {
        if (!window.solflare?.isSolflare) {
          showStatus('Solflare wallet not found. Please install it.', 'error');
          return;
        }

        await window.solflare.connect();
        const publicKey = window.solflare.publicKey.toString();

        walletState = {
          connected: true,
          address: publicKey.substring(0, 4) + '...' + publicKey.slice(-4),
          fullAddress: publicKey,
          type: 'solflare'
        };
        showStatus('Solflare connected!', 'success');

        // Pre-load @solana/web3.js in background for faster launches
        loadSolanaWeb3().catch(e => console.warn('[ACL] Pre-load web3 failed:', e));

      } else {
        showStatus(`${walletType} not supported`, 'error');
        return;
      }

      updateWalletUI();
      saveWalletState();
      updateLaunchButton();

    } catch (err) {
      console.error('[ACL] Wallet connection error:', err);
      showStatus(`Connection failed: ${err.message}`, 'error');
    }
  }

  /**
   * Update wallet UI
   */
  function updateWalletUI() {
    const statusEl = panel.querySelector('#acl-wallet-status');
    const dot = statusEl?.querySelector('.acl-status-dot');
    const textEl = statusEl?.querySelector('.acl-status-text');
    const balanceEl = panel.querySelector('#acl-wallet-balance');
    const connectBtn = panel.querySelector('#acl-connect-btn');

    if (walletState.connected) {
      if (dot) {
        dot.classList.remove('bg-red-500');
        dot.classList.add('bg-green-500');
        dot.style.boxShadow = '0 0 6px rgb(34 197 94)';
      }
      if (textEl) textEl.textContent = walletState.address;
      if (connectBtn) connectBtn.textContent = 'Change';
      // Fetch and display SOL balance
      fetchAndDisplayBalance();
    } else {
      if (dot) {
        dot.classList.remove('bg-green-500');
        dot.classList.add('bg-red-500');
        dot.style.boxShadow = '';
      }
      if (textEl) textEl.textContent = 'Not Connected';
      if (balanceEl) balanceEl.style.display = 'none';
      if (connectBtn) connectBtn.textContent = 'Connect';
    }
  }

  /**
   * Fetch and display SOL balance for connected wallet
   */
  async function fetchAndDisplayBalance() {
    const balanceEl = panel.querySelector('#acl-wallet-balance');
    if (!balanceEl || !walletState.connected || !walletState.fullAddress) return;

    try {
      balanceEl.textContent = '...';
      balanceEl.style.display = 'inline';

      const response = await fetch(RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [walletState.fullAddress]
        })
      });

      const data = await response.json();
      if (data.result?.value !== undefined) {
        const solBalance = data.result.value / 1e9;
        balanceEl.textContent = `${solBalance.toFixed(3)} SOL`;
        balanceEl.style.color = solBalance > 0.1 ? 'rgb(134 239 172)' : 'rgb(251 191 36)';
      } else {
        balanceEl.style.display = 'none';
      }
    } catch (err) {
      console.warn('[ACL] Failed to fetch balance:', err);
      balanceEl.style.display = 'none';
    }
  }

  /**
   * Handle launch
   */
  async function handleLaunch(e) {
    e.preventDefault();

    const launchBtn = panel.querySelector('#acl-launch-btn');
    const btnText = launchBtn?.querySelector('.btn-text');
    const btnLoader = launchBtn?.querySelector('.btn-loader');

    if (launchBtn) launchBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoader) btnLoader.style.display = 'flex';

    try {
      const launchData = {
        platform: selectedPlatform,
        name: panel.querySelector('#acl-name')?.value.trim(),
        ticker: panel.querySelector('#acl-ticker')?.value.trim().toUpperCase(),
        description: panel.querySelector('#acl-description')?.value.trim(),
        twitter: panel.querySelector('#acl-twitter')?.value.trim(),
        telegram: panel.querySelector('#acl-telegram')?.value.trim(),
        website: panel.querySelector('#acl-website')?.value.trim(),
        buyAmount: parseFloat(panel.querySelector('#acl-buy-amount')?.value) || 0,
        slippage: parseInt(panel.querySelector('#acl-slippage')?.value) || 10,
        imageUrl: currentToken?.imageUrl,
        contractAddress: currentToken?.contractAddress
      };

      // Execute the actual launch
      let result;
      if (selectedPlatform === 'pump') {
        result = await executePumpLaunch(launchData);
      } else if (selectedPlatform === 'bonk') {
        result = await executeBonkLaunch(launchData);
      } else if (selectedPlatform === 'bags') {
        result = await executeBagsLaunch(launchData);
      }

      if (result?.success) {
        const shortMint = result.mintAddress ? result.mintAddress.substring(0, 6) + '...' : '';
        showStatus(`Launched! Token: ${shortMint}`, 'success');
        console.log('[ACL] Launch successful:', result);

        // Open token page in new tab based on platform
        if (result.mintAddress) {
          if (selectedPlatform === 'bonk') {
            window.open(`https://bonk.fun/coin/${result.mintAddress}`, '_blank');
          } else if (selectedPlatform === 'bags') {
            window.open(`https://bags.fm/token/${result.mintAddress}`, '_blank');
          } else {
            window.open(`https://pump.fun/coin/${result.mintAddress}`, '_blank');
          }
        }
      }

    } catch (err) {
      console.error('[ACL] Launch error:', err);

      // Detect common errors and show user-friendly messages
      const errorMsg = err.message || '';
      if (errorMsg.includes('0x1772') || errorMsg.includes('insufficient funds for rent')) {
        showStatus('Buy amount too small. Try increasing it.', 'error');
      } else if (errorMsg.includes('0x1') || errorMsg.includes('insufficient lamports')) {
        showStatus('Insufficient SOL balance.', 'error');
      } else if (errorMsg.includes('blockhash')) {
        showStatus('Transaction expired. Please try again.', 'error');
      } else {
        showStatus(`Error: ${errorMsg}`, 'error');
      }
    } finally {
      if (btnText) btnText.style.display = '';
      if (btnLoader) btnLoader.style.display = 'none';
      updateLaunchButton();
    }
  }

  /**
   * Update launch button state
   */
  function updateLaunchButton() {
    const nameVal = panel.querySelector('#acl-name')?.value.trim();
    const tickerVal = panel.querySelector('#acl-ticker')?.value.trim();
    const launchBtn = panel.querySelector('#acl-launch-btn');

    const canLaunch = nameVal && tickerVal && walletState.connected;
    if (launchBtn) launchBtn.disabled = !canLaunch;
  }

  /**
   * Show status message
   */
  function showStatus(message, type = 'info') {
    const statusEl = panel.querySelector('#acl-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.style.display = 'block';

    if (type === 'success') {
      statusEl.style.cssText = 'display: block; border: 1px solid #22c55e; background: rgba(34, 197, 94, 0.1); color: #4ade80;';
      setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    } else if (type === 'error') {
      statusEl.style.cssText = 'display: block; border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.1); color: #f87171;';
    } else {
      statusEl.style.cssText = 'display: block; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6);';
    }
  }

  /**
   * Populate panel with token data
   */
  function populateToken(token) {
    if (!token || !panel) return;

    currentToken = token;
    originalImageUrl = token.imageUrl;
    customImageBlob = null; // Reset custom image when loading new token

    // Hide reset button
    const resetBtn = panel.querySelector('#acl-reset-image');
    if (resetBtn) resetBtn.classList.add('acl-hidden');

    const imageContainer = panel.querySelector('#acl-token-image');
    if (imageContainer && token.imageUrl) {
      const img = document.createElement('img');
      img.src = token.imageUrl;
      img.alt = token.name || '';
      img.className = 'h-full w-full object-cover';
      img.onerror = () => {
        // Fallback: show first letter of ticker/name
        const letter = (token.ticker || token.name || '?')[0].toUpperCase();
        imageContainer.innerHTML = `<span class="text-[16px] font-bold text-white/60">${letter}</span>`;
      };
      imageContainer.innerHTML = '';
      imageContainer.appendChild(img);
    }

    const nameEl = panel.querySelector('#acl-token-name');
    const tickerEl = panel.querySelector('#acl-token-ticker');
    const caEl = panel.querySelector('#acl-token-ca');

    if (nameEl) nameEl.textContent = token.name || 'Unknown Token';
    if (tickerEl) tickerEl.textContent = token.ticker ? `$${token.ticker.replace(/^\$/, '')}` : '$???';
    if (caEl) caEl.textContent = token.contractAddress
      ? token.contractAddress.substring(0, 8) + '...' + token.contractAddress.slice(-6)
      : 'No address';

    const fields = {
      '#acl-name': token.name || '',
      '#acl-ticker': token.ticker || '',
      '#acl-description': token.description || '',
      '#acl-twitter': token.twitter || '',
      '#acl-telegram': token.telegram || '',
      '#acl-website': token.website || ''
    };

    Object.entries(fields).forEach(([sel, val]) => {
      const el = panel.querySelector(sel);
      if (el) el.value = val;
    });

    updateLaunchButton();
  }

  /**
   * Load token data
   */
  function loadTokenData() {
    window.postMessage({ type: 'ACL_REQUEST_DATA' }, '*');
  }

  /**
   * Handle data response
   */
  function handleDataResponse(data) {
    if (data.currentToken) populateToken(data.currentToken);

    if (data.settings) {
      const buyEl = panel.querySelector('#acl-buy-amount');
      const slipEl = panel.querySelector('#acl-slippage');
      if (buyEl) buyEl.value = data.settings.defaultBuyAmount || 0.1;
      if (slipEl) slipEl.value = data.settings.defaultSlippage || 10;
    }

    if (data.selectedPlatform && PLATFORMS[data.selectedPlatform]) {
      handlePlatformSelect(data.selectedPlatform);
    }

    // Load auto-sign settings
    autosignEnabled = data.autosignEnabled || false;
    if (data.importedWallet && data.importedWallet.privateKey) {
      storedPrivateKey = data.importedWallet.privateKey;
      console.log('[ACL] Auto-sign mode:', autosignEnabled ? 'ENABLED' : 'disabled');
    }

    // Load RPC config
    if (data.rpcConfig) {
      rpcConfig = data.rpcConfig;
    }

    // Load AI settings
    if (data.aiProvider) aiProvider = data.aiProvider;
    if (data.aiApiKey) aiApiKey = data.aiApiKey;
    if (data.geminiImageKey) geminiImageKey = data.geminiImageKey;

    // Restore connected wallet (Phantom/Solflare/Burner/Imported)
    if (data.connectedWallet && data.connectedWallet.type) {
      const wallet = data.connectedWallet;

      // For external wallets, verify still connected
      if (wallet.type === 'phantom' && window.solana?.isConnected) {
        walletState = {
          connected: true,
          address: wallet.address,
          fullAddress: wallet.fullAddress,
          type: 'phantom'
        };
        updateWalletUI();
        updateLaunchButton();
        // Pre-load web3.js for faster launches
        loadSolanaWeb3().catch(e => console.warn('[ACL] Pre-load web3 failed:', e));
      } else if (wallet.type === 'solflare' && window.solflare?.isConnected) {
        walletState = {
          connected: true,
          address: wallet.address,
          fullAddress: wallet.fullAddress,
          type: 'solflare'
        };
        updateWalletUI();
        updateLaunchButton();
        // Pre-load web3.js for faster launches
        loadSolanaWeb3().catch(e => console.warn('[ACL] Pre-load web3 failed:', e));
      } else if (wallet.type === 'burner' || wallet.type === 'imported') {
        walletState = { 
          connected: true, 
          address: wallet.address, 
          fullAddress: wallet.fullAddress || wallet.address,
          type: wallet.type 
        };
        updateWalletUI();
        updateLaunchButton();
        // Pre-load web3.js for faster launches
        loadSolanaWeb3().catch(e => console.warn('[ACL] Pre-load web3 failed:', e));
      }
    } else if (data.burnerWallet) {
      // Legacy burner wallet support
      walletState = { connected: true, address: data.burnerWallet.address, type: 'burner' };
      updateWalletUI();
      updateLaunchButton();
    } else if (data.importedWallet) {
      // Imported wallet support
      walletState = { 
        connected: true, 
        address: data.importedWallet.address, 
        fullAddress: data.importedWallet.address,
        type: 'imported' 
      };
      updateWalletUI();
      updateLaunchButton();
    }
  }

  /**
   * Save state
   */
  function saveState() {
    const state = { width: panelWidth, isDocked };
    if (!isDocked && panel) {
      state.left = panel.style.left;
      state.top = panel.style.top;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /**
   * Load position (floating only)
   */
  function loadPosition() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.left) panel.style.left = state.left;
        if (state.top) panel.style.top = state.top;
      } else {
        panel.style.top = '80px';
        panel.style.right = '20px';
      }
    } catch {
      panel.style.top = '80px';
      panel.style.right = '20px';
    }
  }

  /**
   * Save wallet state
   */
  function saveWalletState() {
    if (walletState.connected) {
      window.postMessage({
        type: 'ACL_SAVE_DATA',
        key: 'connectedWallet',
        value: {
          address: walletState.address,
          fullAddress: walletState.fullAddress || walletState.address,
          type: walletState.type,
          connectedAt: Date.now()
        }
      }, '*');
    }
  }

  /**
   * Show panel
   */
  function showPanel(tokenData = null) {
    if (!panel) createPanel();

    if (tokenData) {
      populateToken(tokenData);
      window.postMessage({ type: 'ACL_SAVE_DATA', key: 'currentToken', value: tokenData }, '*');
    }

    if (isDocked) {
      panel.style.display = '';
    } else {
      panel.classList.add('visible');
    }
  }

  /**
   * Hide panel
   */
  function hidePanel() {
    if (!panel) return;

    if (isDocked) {
      panel.style.display = 'none';
    } else {
      panel.classList.remove('visible');
    }
  }

  /**
   * Toggle panel
   */
  function togglePanel() {
    console.log('[ACL Panel] togglePanel called, isDocked:', isDocked);

    // If panel exists but isn't docked, try to dock it now (Axiom may have loaded)
    if (panel && !isDocked) {
      const result = findAxiomPanelContainer();
      if (result && result.container) {
        console.log('[ACL Panel] Found Axiom container on toggle, re-docking...');
        // Remove floating panel
        panel.remove();
        panel = null;
        // Recreate as docked
        createPanel();
        showPanel();
        return;
      }
    }

    if (!panel) {
      createPanel();
      showPanel();
      return;
    }

    if (isDocked) {
      if (panel.style.display === 'none') {
        showPanel();
      } else {
        hidePanel();
      }
    } else {
      panel.classList.toggle('visible');
    }
  }

  // ==================== SETTINGS MODAL ====================

  function showSettingsModal() {
    const existingModal = document.getElementById('acl-settings-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'acl-settings-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:1000000;display:flex;align-items:center;justify-content:center;';

    modal.innerHTML = `
      <div style="background:#0d0d0f;border:1px solid rgba(255,255,255,0.1);border-radius:12px;width:360px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.6);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid rgba(255,255,255,0.1);">
          <span style="font-size:14px;font-weight:600;color:white;">Settings</span>
          <button id="acl-modal-close" style="background:transparent;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:18px;padding:4px;">×</button>
        </div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="font-size:11px;color:rgba(255,255,255,0.6);font-weight:500;">RPC Endpoint</label>
            <select id="acl-rpc-select" style="background:#1a1a1d;border:1px solid rgba(255,255,255,0.2);border-radius:6px;padding:8px 10px;color:white;font-size:12px;cursor:pointer;">
              <option value="free" style="background:#1a1a1d;color:white;" ${rpcConfig.type === 'free' ? 'selected' : ''}>Free Public RPC</option>
              <option value="helius" style="background:#1a1a1d;color:white;" ${rpcConfig.type === 'helius' ? 'selected' : ''}>Helius (Free Tier)</option>
              <option value="custom" style="background:#1a1a1d;color:white;" ${rpcConfig.type === 'custom' ? 'selected' : ''}>Custom RPC</option>
            </select>
            <div id="acl-helius-input" style="display:${rpcConfig.type === 'helius' ? 'block' : 'none'};">
              <input type="text" id="acl-helius-key" placeholder="Helius API Key" value="${rpcConfig.heliusKey || ''}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:white;font-size:12px;box-sizing:border-box;">
              <a href="https://helius.dev" target="_blank" style="font-size:10px;color:#00ff88;text-decoration:none;">Get free key →</a>
            </div>
            <div id="acl-custom-rpc-input" style="display:${rpcConfig.type === 'custom' ? 'block' : 'none'};">
              <input type="url" id="acl-custom-rpc" placeholder="https://your-rpc-endpoint.com" value="${rpcConfig.customUrl || ''}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:white;font-size:12px;box-sizing:border-box;">
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(255,255,255,0.05);border-radius:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <div><div style="font-size:12px;color:white;">⚡ Auto-Sign Mode</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">Sign without wallet popup</div></div>
              <label style="position:relative;display:inline-block;width:40px;height:20px;">
                <input type="checkbox" id="acl-autosign-toggle" ${autosignEnabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
                <span id="acl-toggle-slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${autosignEnabled ? '#00ff88' : '#333'};transition:0.3s;border-radius:20px;"></span>
              </label>
            </div>
            <div id="acl-private-key-section" style="display:${autosignEnabled ? 'block' : 'none'};">
              <input type="password" id="acl-private-key" placeholder="Base58 Private Key (from Phantom export)" value="${storedPrivateKey || ''}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:white;font-size:11px;font-family:monospace;box-sizing:border-box;">
              <div style="font-size:9px;color:rgba(255,255,255,0.4);margin-top:4px;">⚠️ Key stored locally. Export from Phantom: Settings → Security → Export Private Key</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);border-radius:6px;">
            <label style="font-size:11px;color:rgba(255,255,255,0.6);font-weight:500;">🧠 Text AI (Ideas & Names)</label>
            <select id="acl-ai-provider" style="background:#1a1a1d;border:1px solid rgba(139,92,246,0.4);border-radius:6px;padding:8px 10px;color:white;font-size:12px;cursor:pointer;">
              <option value="anthropic" style="background:#1a1a1d;color:white;" ${aiProvider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude) ⭐ Recommended</option>
              <option value="openai" style="background:#1a1a1d;color:white;" ${aiProvider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4o)</option>
              <option value="gemini" style="background:#1a1a1d;color:white;" ${aiProvider === 'gemini' ? 'selected' : ''}>Google (Gemini)</option>
            </select>
            <input type="password" id="acl-ai-key" placeholder="API Key for text AI" value="${aiApiKey}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:white;font-size:12px;box-sizing:border-box;">
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);border-radius:6px;">
            <label style="font-size:11px;color:rgba(255,255,255,0.6);font-weight:500;">🎨 Image AI (Logo Generation)</label>
            <input type="password" id="acl-gemini-image-key" placeholder="Gemini API Key (optional - uses free Pollinations without)" value="${geminiImageKey || ''}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:white;font-size:12px;box-sizing:border-box;">
            <small style="font-size:10px;color:rgba(255,255,255,0.4);">Gemini Imagen = best quality • Leave empty for free Pollinations</small>
          </div>
          <div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;">
            <small style="font-size:10px;color:rgba(255,255,255,0.5);">💡 ALT+Click = opposite • ALT+SHIFT+Click = beta play</small>
          </div>
          <button id="acl-save-settings" style="width:100%;background:linear-gradient(135deg,#00ff88 0%,#00cc6a 100%);border:none;border-radius:8px;padding:10px;color:#0d0d0f;font-size:12px;font-weight:600;cursor:pointer;">Save Settings</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#acl-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('#acl-rpc-select').addEventListener('change', (e) => {
      modal.querySelector('#acl-helius-input').style.display = e.target.value === 'helius' ? 'block' : 'none';
      modal.querySelector('#acl-custom-rpc-input').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    modal.querySelector('#acl-autosign-toggle').addEventListener('change', (e) => {
      modal.querySelector('#acl-toggle-slider').style.backgroundColor = e.target.checked ? '#00ff88' : '#333';
      modal.querySelector('#acl-private-key-section').style.display = e.target.checked ? 'block' : 'none';
    });

    modal.querySelector('#acl-save-settings').addEventListener('click', () => {
      const rpcType = modal.querySelector('#acl-rpc-select').value;
      const heliusKey = modal.querySelector('#acl-helius-key')?.value || '';
      const customUrl = modal.querySelector('#acl-custom-rpc')?.value || '';

      rpcConfig = {
        type: rpcType,
        url: rpcType === 'free' ? 'https://api.mainnet-beta.solana.com' : rpcType === 'helius' ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : customUrl,
        heliusKey, customUrl
      };

      autosignEnabled = modal.querySelector('#acl-autosign-toggle').checked;
      const privateKeyInput = modal.querySelector('#acl-private-key').value.trim();
      aiProvider = modal.querySelector('#acl-ai-provider').value;
      aiApiKey = modal.querySelector('#acl-ai-key').value;
      geminiImageKey = modal.querySelector('#acl-gemini-image-key').value;

      // Update storedPrivateKey in memory
      storedPrivateKey = privateKeyInput || null;

      // Save importedWallet with private key (matches load logic)
      if (privateKeyInput) {
        window.postMessage({ type: 'ACL_SAVE_DATA', key: 'importedWallet', value: { privateKey: privateKeyInput, address: walletState.fullAddress || '' } }, '*');
      }

      window.postMessage({ type: 'ACL_SAVE_DATA', key: 'rpcConfig', value: rpcConfig }, '*');
      window.postMessage({ type: 'ACL_SAVE_DATA', key: 'autosignEnabled', value: autosignEnabled }, '*');
      window.postMessage({ type: 'ACL_SAVE_DATA', key: 'aiProvider', value: aiProvider }, '*');
      window.postMessage({ type: 'ACL_SAVE_DATA', key: 'aiApiKey', value: aiApiKey }, '*');
      window.postMessage({ type: 'ACL_SAVE_DATA', key: 'geminiImageKey', value: geminiImageKey }, '*');

      showStatus('Settings saved!', 'success');
      modal.remove();
    });
  }

  // ==================== AI OPPOSITE GENERATOR ====================

  async function generateOppositeToken(tokenData) {
    if (!panel) createPanel();
    showPanel();
    showStatus('Generating opposite concept...', 'info');

    try {
      let oppositeData = aiApiKey ? await generateOppositeWithAI(tokenData) : generateOppositeWithFallback(tokenData);

      if (tokenData.imageUrl) {
        showStatus('Inverting image...', 'info');
        try {
          const invertedBlob = await invertImage(tokenData.imageUrl);
          if (invertedBlob) {
            customImageBlob = invertedBlob;
            const resetBtn = panel.querySelector('#acl-reset-image');
            if (resetBtn) resetBtn.classList.remove('acl-hidden');
            const reader = new FileReader();
            reader.onload = (e) => updateTokenImagePreview(e.target.result);
            reader.readAsDataURL(invertedBlob);
          }
        } catch (imgErr) { console.warn('[ACL] Image inversion failed:', imgErr); }
      }

      const nameInput = panel.querySelector('#acl-name');
      const tickerInput = panel.querySelector('#acl-ticker');
      const descInput = panel.querySelector('#acl-description');
      if (nameInput) nameInput.value = oppositeData.name;
      if (tickerInput) tickerInput.value = oppositeData.ticker;
      if (descInput) descInput.value = oppositeData.description;

      originalImageUrl = tokenData.imageUrl;
      currentToken = { ...tokenData, name: oppositeData.name, ticker: oppositeData.ticker, description: oppositeData.description };

      const nameEl = panel.querySelector('#acl-token-name');
      const tickerEl = panel.querySelector('#acl-token-ticker');
      if (nameEl) nameEl.textContent = oppositeData.name;
      if (tickerEl) tickerEl.textContent = `$${(oppositeData.ticker || '').replace(/^\$/, '')}`;

      updateLaunchButton();
      showStatus('Opposite generated! Review and launch.', 'success');
    } catch (err) {
      console.error('[ACL] Opposite generation error:', err);
      showStatus(`Error: ${err.message}`, 'error');
    }
  }

  async function generateOppositeWithAI(tokenData) {
    const prompt = `Generate the conceptual OPPOSITE of meme token "${tokenData.name}" ($${tokenData.ticker}).

CRITICAL RULES:
1. Find the TRUE semantic opposite - not just a generic antonym
2. For compound names, replace EACH word with its opposite: "Black Sheep" → "White Wolf", "Dark Knight" → "Light Peasant"
3. Color opposites: black↔white, red↔blue, gold↔silver, bright↔dim
4. Animal pairs: wolf↔sheep, lion↔lamb, eagle↔snake, cat↔dog, bull↔bear
5. Concept pairs: king↔peasant, hero↔villain, angel↔demon, alpha↔omega, rich↔poor
6. Keep same STYLE/FORMAT as original (if 2 words, make 2 words; if alliterative, stay alliterative)
7. Ticker should be a logical abbreviation of the new name (3-6 chars)
8. Description should playfully reference being the "opposite" or "nemesis"

Example transformations:
- "Sad Cat" → "Happy Dog"
- "Golden Bull" → "Silver Bear"
- "Dark Lord" → "Light Servant"
- "Rich Ape" → "Poor Sloth"

Respond ONLY with valid JSON: {"name":"...","ticker":"...","description":"..."}`;

    const { endpoint, headers, body, extractText } = buildAIRequest(prompt, 256);
    const response = await proxyFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('AI API request failed');

    const text = extractText(response.data);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid AI response');
    return JSON.parse(jsonMatch[0]);
  }

  // Helper to build AI API requests for different providers
  function buildAIRequest(prompt, maxTokens = 256) {
    if (aiProvider === 'anthropic') {
      return {
        endpoint: 'https://api.anthropic.com/v1/messages',
        headers: { 'Content-Type': 'application/json', 'x-api-key': aiApiKey, 'anthropic-version': '2023-06-01' },
        body: { model: 'claude-3-haiku-20240307', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
        extractText: (data) => data.content[0].text
      };
    } else if (aiProvider === 'gemini') {
      return {
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${aiApiKey}`,
        headers: { 'Content-Type': 'application/json' },
        body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } },
        extractText: (data) => data.candidates[0].content.parts[0].text
      };
    } else {
      return {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiApiKey}` },
        body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens },
        extractText: (data) => data.choices[0].message.content
      };
    }
  }

  function generateOppositeWithFallback(tokenData) {
    const name = tokenData.name || '';
    const ticker = tokenData.ticker || '';

    // Find opposite for a single word (exact match preferred)
    const findWordOpposite = (word) => {
      const lower = word.toLowerCase();
      // First try exact match
      if (OPPOSITE_FALLBACKS[lower]) {
        const opp = OPPOSITE_FALLBACKS[lower];
        // Preserve original casing style
        if (word === word.toUpperCase()) return opp.toUpperCase();
        if (word[0] === word[0].toUpperCase()) return opp.charAt(0).toUpperCase() + opp.slice(1);
        return opp;
      }
      return null;
    };

    // Process compound name - replace each word with its opposite
    const processPhrase = (phrase) => {
      const words = phrase.split(/(\s+)/); // Keep delimiters (spaces)
      let anyReplaced = false;

      const result = words.map(word => {
        if (/^\s+$/.test(word)) return word; // Keep spaces as-is
        const opposite = findWordOpposite(word);
        if (opposite) {
          anyReplaced = true;
          return opposite;
        }
        return word;
      });

      // If no words were replaced, prefix with "Anti"
      if (!anyReplaced && phrase.trim()) {
        return 'Anti ' + phrase;
      }
      return result.join('');
    };

    const oppositeName = processPhrase(name);
    const oppositeTicker = processPhrase(ticker).toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);

    return {
      name: oppositeName,
      ticker: oppositeTicker || 'ANTI' + ticker.substring(0, 6).toUpperCase(),
      description: `The opposite of ${name}. When they zig, we zag.`
    };
  }

  // ==================== AI BETA PLAY GENERATOR ====================

  async function generateBetaPlay(tokenData) {
    if (!panel) createPanel();
    showPanel();
    showStatus('🧠 Finding beta play...', 'info');

    try {
      if (!aiApiKey) {
        showStatus('Beta play requires AI API key in settings', 'error');
        return;
      }

      const betaData = await generateBetaPlayWithAI(tokenData);

      const nameInput = panel.querySelector('#acl-name');
      const tickerInput = panel.querySelector('#acl-ticker');
      const descInput = panel.querySelector('#acl-description');
      if (nameInput) nameInput.value = betaData.name;
      if (tickerInput) tickerInput.value = betaData.ticker;
      if (descInput) descInput.value = betaData.description;

      // Generate image using Gemini (if key provided) or Pollinations (free fallback)
      const imagePrompt = betaData.imagePrompt || `${betaData.name} mascot character`;
      showStatus(geminiImageKey ? '🎨 Gemini...' : '🎨 Pollinations...', 'info');
      try {
        const imageBlob = await generateAIImage(imagePrompt);
        if (imageBlob) {
          customImageBlob = imageBlob;
          const resetBtn = panel.querySelector('#acl-reset-image');
          if (resetBtn) resetBtn.classList.remove('acl-hidden');
          const reader = new FileReader();
          reader.onload = (e) => updateTokenImagePreview(e.target.result);
          reader.readAsDataURL(imageBlob);
        }
      } catch (imgErr) {
        console.warn('[ACL] Image generation failed:', imgErr);
        showStatus('Image gen failed, using original', 'warning');
      }

      originalImageUrl = tokenData.imageUrl;
      currentToken = { ...tokenData, name: betaData.name, ticker: betaData.ticker, description: betaData.description };

      const nameEl = panel.querySelector('#acl-token-name');
      const tickerEl = panel.querySelector('#acl-token-ticker');
      if (nameEl) nameEl.textContent = betaData.name;
      if (tickerEl) tickerEl.textContent = `$${(betaData.ticker || '').replace(/^\$/, '')}`;

      updateLaunchButton();
      showStatus(`Beta play: ${betaData.reasoning}`, 'success');
    } catch (err) {
      console.error('[ACL] Beta play error:', err);
      showStatus(`Error: ${err.message}`, 'error');
    }
  }

  // Generate image - uses Gemini if key provided, otherwise Pollinations (free)
  async function generateAIImage(prompt) {
    console.log('[ACL] generateAIImage called, geminiImageKey exists:', !!geminiImageKey);
    console.log('[ACL] Image prompt:', prompt);

    if (geminiImageKey) {
      try {
        console.log('[ACL] Trying Gemini image generation...');
        return await generateGeminiImage(prompt);
      } catch (err) {
        console.warn('[ACL] Gemini failed, falling back to Pollinations:', err.message);
        return await generatePollinationsImage(prompt);
      }
    }

    console.log('[ACL] Using Pollinations (no Gemini key)...');
    return await generatePollinationsImage(prompt);
  }

  // Generate image using Google Gemini (works with standard API key)
  async function generateGeminiImage(prompt) {
    const enhancedPrompt = `Generate a meme coin logo: ${prompt}. Style: circular token icon, vibrant colors, simple bold design, crypto aesthetic, centered composition.`;

    // Use gemini-2.0-flash-exp which supports image generation with standard API key
    const response = await proxyFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiImageKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: enhancedPrompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE']
          }
        })
      }
    );

    if (!response.ok) {
      console.error('[ACL] Gemini error:', response);
      throw new Error('Gemini image request failed');
    }

    const data = response.data;
    console.log('[ACL] Gemini response:', data);

    // Find image part in response
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData?.data) {
      console.error('[ACL] No image in response, parts:', parts);
      throw new Error('No image in Gemini response - model may not support image generation');
    }

    // Convert base64 to blob
    const base64 = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    return new Blob([byteArray], { type: mimeType });
  }

  // Generate image using Pollinations.ai (free, no API key required)
  async function generatePollinationsImage(prompt) {
    const enhancedPrompt = `${prompt}, meme coin logo, circular token icon, vibrant colors, simple bold design, crypto aesthetic, high quality`;
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=512&nologo=true&seed=${Date.now()}`;

    console.log('[ACL] Pollinations URL:', url);

    try {
      // Use proxyFetch to bypass CSP restrictions
      const response = await proxyFetch(url, { responseType: 'blob' });
      console.log('[ACL] Pollinations response:', response.ok, response.responseType);

      if (!response.ok) throw new Error(`Pollinations failed: ${response.status}`);

      // proxyFetch returns base64 for blob/image responses
      if (response.responseType === 'blob' && response.data?.base64) {
        const byteChars = atob(response.data.base64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: response.data.mimeType || 'image/png' });
        console.log('[ACL] Pollinations blob created, size:', blob.size);
        return blob;
      }

      throw new Error('Unexpected response type from Pollinations');
    } catch (err) {
      console.error('[ACL] Pollinations error:', err);
      throw err;
    }
  }

  async function generateBetaPlayWithAI(tokenData) {
    const prompt = `You are a degen meme coin trader. Given the trending token "${tokenData.name}" ($${tokenData.ticker}), suggest a BETA PLAY - a derivative/related token idea that could ride the same narrative.

BETA PLAY TYPES (pick the best fit):
1. **Opposite/Inverse** - If original is bullish, make bearish version (but be creative, not just "dump")
2. **Sidekick/Companion** - Related character (Batman → Robin, Pepe → Wojak)
3. **Parody/Satirical** - Funny twist on the original concept
4. **Same Universe** - Different character from same meme/story
5. **Meta Commentary** - Token about the token itself (e.g. "[Original] Haters", "Why [Original] Rugged")
6. **Phonetic Play** - Similar sounding but different meaning
7. **Evolution/Devolution** - What it becomes or came from

RULES:
- Must be FUNNY and memeable
- Should feel related but distinct
- Ticker 3-6 chars, catchy
- Description should be short, punchy, degen-speak OK
- imagePrompt should describe a simple mascot/character for the token (will be used to generate logo)

Respond with JSON:
{
  "name": "...",
  "ticker": "...",
  "description": "...",
  "reasoning": "2-5 word explanation of the play type",
  "imagePrompt": "simple description of mascot/character, e.g. 'sad crying frog' or 'angry white wolf with red eyes'"
}`;

    const { endpoint, headers, body, extractText } = buildAIRequest(prompt, 350);
    const response = await proxyFetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('AI API request failed');

    const text = extractText(response.data);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid AI response');
    return JSON.parse(jsonMatch[0]);
  }

  async function invertImage(imageUrl) {
    return new Promise(async (resolve, reject) => {
      try {
        const imageBlob = await downloadImage(imageUrl);
        if (!imageBlob) { reject(new Error('Failed to download image')); return; }

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];
            data[i + 1] = 255 - data[i + 1];
            data[i + 2] = 255 - data[i + 2];
          }
          ctx.putImageData(imageData, 0, 0);

          canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error('Canvas to blob failed')); }, 'image/png');
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = URL.createObjectURL(imageBlob);
      } catch (err) { reject(err); }
    });
  }

  // Message listener
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const { type } = event.data || {};

    switch (type) {
      case 'ACL_SHOW_PANEL': showPanel(event.data.tokenData); break;
      case 'ACL_TOGGLE_PANEL': togglePanel(); break;
      case 'ACL_DATA_RESPONSE': handleDataResponse(event.data.data); break;
      case 'ACL_LAUNCH_RESPONSE':
        if (event.data.success) showStatus('Launch initiated! Check wallet for approval.', 'success');
        else showStatus(`Error: ${event.data.error || 'Launch failed'}`, 'error');
        break;
      case 'ACL_GENERATE_OPPOSITE': generateOppositeToken(event.data.tokenData); break;
      case 'ACL_GENERATE_BETA_PLAY': generateBetaPlay(event.data.tokenData); break;
    }
  });

  // Export
  window.ACLPanel = { show: showPanel, hide: hidePanel, toggle: togglePanel, populateToken };

  /**
   * Create toolbar toggle button
   */
  function createToggleButton() {
    if (document.getElementById('acl-toggle-btn')) return;

    const injectIntoToolbar = () => {
      const pulseIcon = document.querySelector('i.ri-pulse-line');
      const barChartIcon = document.querySelector('i.ri-bar-chart-line');

      let targetButton = pulseIcon?.closest('button') || barChartIcon?.closest('button');
      let container = targetButton?.parentElement;

      if (container && !document.getElementById('acl-toggle-btn')) {
        // Create wrapper to isolate from Axiom's tooltip system
        const wrapper = document.createElement('div');
        wrapper.id = 'acl-toggle-btn';
        wrapper.style.cssText = 'position: relative; display: flex; align-items: center;';

        const btn = document.createElement('button');
        btn.className = 'flex h-[24px] cursor-pointer items-center justify-center gap-[4px] rounded-[4px] px-[4px] border border-transparent hover:bg-white/10';
        btn.style.cssText = 'position: relative;';
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#00ff88">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        `;

        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          togglePanel();
        });

        // Custom tooltip positioned above
        const tooltip = document.createElement('div');
        tooltip.textContent = 'Beta Launch';
        tooltip.style.cssText = `
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 6px;
          background: #1a1a1f;
          border: 1px solid rgba(255,255,255,0.2);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.15s;
          z-index: 99999;
        `;
        wrapper.appendChild(tooltip);
        wrapper.appendChild(btn);

        wrapper.addEventListener('mouseenter', () => { tooltip.style.opacity = '1'; });
        wrapper.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });

        container.insertBefore(wrapper, container.firstChild);
        console.log('[ACL Panel] Toolbar button injected');
        return true;
      }
      return false;
    };

    if (injectIntoToolbar()) return;

    let attempts = 0;
    const observer = new MutationObserver((_, obs) => {
      attempts++;
      if (injectIntoToolbar() || attempts > 30) {
        obs.disconnect();
        if (attempts > 30) createFloatingButton();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      if (!document.getElementById('acl-toggle-btn')) createFloatingButton();
    }, 10000);
  }

  /**
   * Floating button fallback
   */
  function createFloatingButton() {
    if (document.getElementById('acl-toggle-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'acl-toggle-btn';
    btn.title = 'Beta Launch (Ctrl+Shift+C)';
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
    btn.style.cssText = `
      position: fixed;
      bottom: 48px;
      left: 12px;
      z-index: 999998;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: #141418;
      border: 1px solid rgba(255,255,255,0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #00ff88;
      transition: all 0.15s ease;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = '#00ff88';
      btn.style.background = 'rgba(0,255,136,0.1)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'rgba(255,255,255,0.1)';
      btn.style.background = '#141418';
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    document.body.appendChild(btn);
    console.log('[ACL Panel] Floating button created');
  }

  // Initialize
  console.log('[ACL Panel] Initializing...');

  // Wait for Axiom to fully load before trying to dock
  const initWithDelay = () => {
    createPanel();
    createToggleButton();

    if (window.location.pathname.includes('/meme/')) {
      setTimeout(() => {
        window.postMessage({ type: 'ACL_REQUEST_EXTRACT' }, '*');
      }, 1000);
    }
  };

  // Try after a short delay to let Axiom render
  setTimeout(initWithDelay, 2000);

  console.log('[ACL Panel] Init scheduled');

})();
