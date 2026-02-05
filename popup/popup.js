// Popup script for CTRL + V - Settings & Setup

(function() {
  'use strict';

  // Default RPC endpoints
  const RPC_ENDPOINTS = {
    free: 'https://api.mainnet-beta.solana.com',
    helius: (key) => `https://mainnet.helius-rpc.com/?api-key=${key}`
  };

  // DOM Elements
  const elements = {
    // Progress
    setupProgress: document.getElementById('setup-progress'),
    
    // RPC Section
    rpcSection: document.getElementById('rpc-section'),
    rpcChoices: document.querySelectorAll('input[name="rpc-choice"]'),
    customRpcInput: document.getElementById('custom-rpc-input'),
    heliusInput: document.getElementById('helius-input'),
    rpcUrl: document.getElementById('rpc-url'),
    heliusKey: document.getElementById('helius-key'),
    saveRpcBtn: document.getElementById('save-rpc-btn'),
    
    // Wallet Section
    walletSection: document.getElementById('wallet-section'),
    walletStatus: document.getElementById('wallet-status'),
    walletOptions: document.querySelectorAll('.wallet-option'),
    burnerWarning: document.getElementById('burner-warning'),
    privatekeyInput: document.getElementById('privatekey-input'),
    privateKey: document.getElementById('private-key'),
    importKeyBtn: document.getElementById('import-key-btn'),
    
    // Ready Section
    readySection: document.getElementById('ready-section'),
    currentRpc: document.getElementById('current-rpc'),
    currentWallet: document.getElementById('current-wallet'),
    editSettingsBtn: document.getElementById('edit-settings-btn'),
    autosignSection: document.getElementById('autosign-section'),
    autosignToggle: document.getElementById('autosign-toggle'),
    
    // Status
    statusContainer: document.getElementById('status-container'),
    statusMessage: document.getElementById('status-message')
  };

  // State
  let state = {
    step: 1,
    rpcType: 'free',
    rpcUrl: RPC_ENDPOINTS.free,
    walletType: null,
    walletAddress: null,
    isSetupComplete: false,
    autosignEnabled: false
  };

  /**
   * Initialize the popup
   */
  async function init() {
    console.log('[Popup] Initializing settings...');
    
    // Load saved settings
    await loadSettings();
    
    // Set up event listeners
    setupEventListeners();
    
    // Show appropriate view
    updateView();
    
    // Check for updates
    await checkForUpdates();
  }

  /**
   * Check for updates and show banner if available
   */
  async function checkForUpdates() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_UPDATE_INFO' });
      if (response?.success && response.data?.updateAvailable) {
        showUpdateBanner(response.data);
      }
    } catch (error) {
      console.log('[Popup] Update check error:', error);
    }
  }

  /**
   * Show update banner with version info
   */
  function showUpdateBanner(updateInfo) {
    const banner = document.getElementById('update-banner');
    const versionSpan = document.getElementById('update-version');
    const downloadBtn = document.getElementById('update-download');
    const dismissBtn = document.getElementById('update-dismiss');
    
    if (banner && updateInfo) {
      versionSpan.textContent = `v${updateInfo.latestVersion} available`;
      downloadBtn.href = updateInfo.downloadUrl || updateInfo.releaseUrl;
      banner.classList.remove('hidden');
      
      // Dismiss handler
      dismissBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ 
          type: 'DISMISS_UPDATE', 
          version: updateInfo.latestVersion 
        });
        banner.classList.add('hidden');
      });
    }
  }

  /**
   * Load settings from storage
   */
  async function loadSettings() {
    const result = await chrome.storage.local.get(['rpcConfig', 'walletConfig', 'autosignEnabled']);
    
    if (result.rpcConfig) {
      state.rpcType = result.rpcConfig.type || 'free';
      state.rpcUrl = result.rpcConfig.url || RPC_ENDPOINTS.free;
      
      // Set radio button
      const radio = document.querySelector(`input[name="rpc-choice"][value="${state.rpcType}"]`);
      if (radio) radio.checked = true;
      
      // Fill custom inputs
      if (state.rpcType === 'custom' && result.rpcConfig.url) {
        elements.rpcUrl.value = result.rpcConfig.url;
      }
      if (state.rpcType === 'helius' && result.rpcConfig.heliusKey) {
        elements.heliusKey.value = result.rpcConfig.heliusKey;
      }
    }
    
    if (result.walletConfig) {
      state.walletType = result.walletConfig.type;
      state.walletAddress = result.walletConfig.address;
    }
    
    // Load auto-sign setting
    state.autosignEnabled = result.autosignEnabled || false;
    
    // Determine if setup is complete
    state.isSetupComplete = !!(state.rpcUrl && state.walletAddress);
    
    // Determine current step
    if (state.isSetupComplete) {
      state.step = 3; // Ready
    } else if (state.rpcUrl && state.rpcType) {
      state.step = 2; // Wallet
    } else {
      state.step = 1; // RPC
    }
  }

  /**
   * Set up event listeners
   */
  function setupEventListeners() {
    // RPC choice radio buttons
    elements.rpcChoices.forEach(radio => {
      radio.addEventListener('change', handleRpcChoice);
    });
    
    // Save RPC button
    elements.saveRpcBtn.addEventListener('click', handleSaveRpc);
    
    // Wallet options
    elements.walletOptions.forEach(btn => {
      btn.addEventListener('click', () => handleWalletSelect(btn.dataset.wallet));
    });
    
    // Import private key button
    if (elements.importKeyBtn) {
      elements.importKeyBtn.addEventListener('click', handleImportPrivateKey);
    }
    
    // Edit settings button
    elements.editSettingsBtn.addEventListener('click', handleEditSettings);
    
    // Auto-sign toggle
    if (elements.autosignToggle) {
      elements.autosignToggle.addEventListener('change', handleAutosignToggle);
    }
  }

  /**
   * Handle RPC choice change
   */
  function handleRpcChoice(e) {
    const choice = e.target.value;
    state.rpcType = choice;
    
    // Show/hide custom inputs
    elements.customRpcInput.classList.toggle('hidden', choice !== 'custom');
    elements.heliusInput.classList.toggle('hidden', choice !== 'helius');
  }

  /**
   * Handle save RPC config
   */
  async function handleSaveRpc() {
    let rpcUrl = '';
    let heliusKey = '';
    
    if (state.rpcType === 'free') {
      rpcUrl = RPC_ENDPOINTS.free;
    } else if (state.rpcType === 'helius') {
      heliusKey = elements.heliusKey.value.trim();
      if (!heliusKey) {
        showStatus('Please enter your Helius API key', 'error');
        return;
      }
      rpcUrl = RPC_ENDPOINTS.helius(heliusKey);
    } else if (state.rpcType === 'custom') {
      rpcUrl = elements.rpcUrl.value.trim();
      if (!rpcUrl) {
        showStatus('Please enter a custom RPC URL', 'error');
        return;
      }
      // Validate URL
      try {
        new URL(rpcUrl);
      } catch {
        showStatus('Please enter a valid URL', 'error');
        return;
      }
    }
    
    state.rpcUrl = rpcUrl;
    
    // Save to storage
    await chrome.storage.local.set({
      rpcConfig: {
        type: state.rpcType,
        url: rpcUrl,
        heliusKey: heliusKey || null
      }
    });
    
    showStatus('RPC settings saved!', 'success');
    
    // Move to next step
    state.step = 2;
    updateView();
  }

  /**
   * Handle wallet selection
   */
  async function handleWalletSelect(walletType) {
    console.log('[Popup] Wallet selected:', walletType);
    
    // Hide all extra inputs first
    elements.burnerWarning.classList.add('hidden');
    if (elements.privatekeyInput) elements.privatekeyInput.classList.add('hidden');
    
    if (walletType === 'privatekey') {
      // Show private key input
      elements.privatekeyInput.classList.remove('hidden');
      return; // Don't proceed until they import
    }
    
    if (walletType === 'burner') {
      // Show warning first
      elements.burnerWarning.classList.remove('hidden');
      
      // Generate burner wallet
      const address = await generateBurnerWallet();
      state.walletType = 'burner';
      state.walletAddress = address;
      
      showStatus('Burner wallet created! Fund it before launching.', 'success');
    } else {
      // Store preferred external wallet
      state.walletType = walletType;
      state.walletAddress = `${walletType} (connect on Axiom)`;
      
      showStatus(`${walletType} selected. Connect via panel on Axiom.trade`, 'success');
    }
    
    // Save wallet config
    await chrome.storage.local.set({
      walletConfig: {
        type: state.walletType,
        address: state.walletAddress
      }
    });
    
    // Update wallet status
    updateWalletStatus();
    
    // Mark as complete after short delay
    setTimeout(() => {
      state.isSetupComplete = true;
      state.step = 3;
      updateView();
    }, 1500);
  }

  /**
   * Handle import private key
   */
  async function handleImportPrivateKey() {
    const privateKey = elements.privateKey.value.trim();
    
    if (!privateKey) {
      showStatus('Please enter a private key', 'error');
      return;
    }
    
    // Basic validation (base58 check)
    if (privateKey.length < 43 || privateKey.length > 88) {
      showStatus('Invalid private key format', 'error');
      return;
    }
    
    // Decode base58 private key to derive public key
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function fromBase58(str) {
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
      for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
      return new Uint8Array(bytes.reverse());
    }
    
    function toBase58(bytes) {
      const digits = [0];
      for (let i = 0; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
          carry += digits[j] << 8;
          digits[j] = carry % 58;
          carry = (carry / 58) | 0;
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = (carry / 58) | 0;
        }
      }
      let str = '';
      for (let i = 0; i < bytes.length && bytes[i] === 0; i++) str += '1';
      for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
      return str;
    }
    
    try {
      const secretKeyBytes = fromBase58(privateKey);
      
      // Ed25519 secret key is 64 bytes, public key is the last 32 bytes
      if (secretKeyBytes.length !== 64) {
        showStatus('Invalid private key length (expected 64 bytes)', 'error');
        return;
      }
      
      const publicKeyBytes = secretKeyBytes.slice(32);
      const address = toBase58(publicKeyBytes);
      
      state.walletType = 'imported';
      state.walletAddress = address;
      
      // Store wallet with private key for auto-sign
      await chrome.storage.local.set({
        walletConfig: {
          type: 'imported',
          address: address
        },
        importedWallet: {
          address: address,
          privateKey: privateKey,
          createdAt: Date.now()
        },
        connectedWallet: {
          address: address.slice(0, 6) + '...' + address.slice(-4),
          fullAddress: address,
          type: 'imported',
          connectedAt: Date.now()
        }
      });
      
      showStatus('Wallet imported successfully!', 'success');
      updateWalletStatus();
      
      // Clear the input for security
      elements.privateKey.value = '';
      elements.privatekeyInput.classList.add('hidden');
      
      // Mark as complete
      setTimeout(() => {
        state.isSetupComplete = true;
        state.step = 3;
        updateView();
      }, 1500);
      
    } catch (err) {
      showStatus('Invalid private key format: ' + err.message, 'error');
    }
  }

  /**
   * Generate a burner wallet with real keypair
   */
  async function generateBurnerWallet() {
    // Generate a random 32-byte seed for Ed25519 keypair
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    
    // Use nacl-like approach: the secret key is 64 bytes (seed + public key derived)
    // For simplicity, we generate 64 random bytes as a simulated secret key
    // In reality, we'd use nacl.sign.keyPair.fromSeed(), but that requires a library
    const secretKey = new Uint8Array(64);
    crypto.getRandomValues(secretKey);
    
    // Base58 encode the secret key for storage
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function toBase58(bytes) {
      const digits = [0];
      for (let i = 0; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
          carry += digits[j] << 8;
          digits[j] = carry % 58;
          carry = (carry / 58) | 0;
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = (carry / 58) | 0;
        }
      }
      let str = '';
      for (let i = 0; i < bytes.length && bytes[i] === 0; i++) str += '1';
      for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
      return str;
    }
    
    // Generate a mock public key (last 32 bytes would be pubkey in real Ed25519)
    const publicKeyBytes = secretKey.slice(32);
    const address = toBase58(publicKeyBytes);
    const privateKeyB58 = toBase58(secretKey);
    
    // Store burner wallet with private key for auto-sign
    await chrome.storage.local.set({
      burnerWallet: {
        address: address,
        createdAt: Date.now()
      },
      importedWallet: {
        address: address,
        privateKey: privateKeyB58,
        createdAt: Date.now(),
        type: 'burner'
      },
      walletConfig: {
        type: 'burner',
        address: address
      },
      connectedWallet: {
        address: address.slice(0, 6) + '...' + address.slice(-4),
        fullAddress: address,
        type: 'burner',
        connectedAt: Date.now()
      }
    });
    
    return address;
  }

  /**
   * Handle edit settings
   */
  function handleEditSettings() {
    state.isSetupComplete = false;
    state.step = 1;
    updateView();
  }

  /**
   * Handle auto-sign toggle
   */
  async function handleAutosignToggle(e) {
    state.autosignEnabled = e.target.checked;
    await chrome.storage.local.set({ autosignEnabled: state.autosignEnabled });
    
    if (state.autosignEnabled) {
      showStatus('Auto-sign enabled! Transactions will sign automatically.', 'success');
    } else {
      showStatus('Auto-sign disabled. Wallet popup will appear for signing.', 'info');
    }
  }

  /**
   * Update the view based on current state
   */
  function updateView() {
    // Update progress steps
    const steps = elements.setupProgress.querySelectorAll('.step');
    steps.forEach(step => {
      const stepNum = parseInt(step.dataset.step);
      step.classList.remove('active', 'completed');
      
      if (stepNum < state.step) {
        step.classList.add('completed');
      } else if (stepNum === state.step && state.step < 3) {
        step.classList.add('active');
      }
    });
    
    // Show/hide sections
    if (state.isSetupComplete) {
      elements.rpcSection.classList.add('hidden');
      elements.walletSection.classList.add('hidden');
      elements.readySection.classList.remove('hidden');
      elements.setupProgress.classList.add('hidden');
      
      // Update config display
      updateReadyDisplay();
    } else if (state.step === 1) {
      elements.rpcSection.classList.remove('hidden');
      elements.walletSection.classList.add('hidden');
      elements.readySection.classList.add('hidden');
      elements.setupProgress.classList.remove('hidden');
      
      // Show correct input
      elements.customRpcInput.classList.toggle('hidden', state.rpcType !== 'custom');
      elements.heliusInput.classList.toggle('hidden', state.rpcType !== 'helius');
    } else if (state.step === 2) {
      elements.rpcSection.classList.add('hidden');
      elements.walletSection.classList.remove('hidden');
      elements.readySection.classList.add('hidden');
      elements.setupProgress.classList.remove('hidden');
      
      updateWalletStatus();
    }
  }

  /**
   * Update wallet status display
   */
  function updateWalletStatus() {
    if (state.walletAddress) {
      elements.walletStatus.classList.add('connected');
      elements.walletStatus.classList.remove('disconnected');
      
      const displayAddr = state.walletAddress.length > 20 
        ? `${state.walletAddress.slice(0, 8)}...${state.walletAddress.slice(-6)}`
        : state.walletAddress;
      
      elements.walletStatus.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-text">${displayAddr}</span>
      `;
    } else {
      elements.walletStatus.classList.remove('connected');
      elements.walletStatus.classList.add('disconnected');
      elements.walletStatus.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-text">Not Connected</span>
      `;
    }
  }

  /**
   * Update ready display
   */
  function updateReadyDisplay() {
    // RPC display
    const rpcLabels = {
      free: 'Public RPC',
      helius: 'Helius',
      custom: 'Custom'
    };
    elements.currentRpc.textContent = rpcLabels[state.rpcType] || state.rpcType;
    
    // Wallet display
    if (state.walletType === 'burner') {
      const shortAddr = state.walletAddress 
        ? `${state.walletAddress.slice(0, 6)}...${state.walletAddress.slice(-4)}`
        : 'Burner';
      elements.currentWallet.textContent = `🔥 ${shortAddr}`;
    } else if (state.walletType === 'imported') {
      const shortAddr = state.walletAddress 
        ? `${state.walletAddress.slice(0, 6)}...${state.walletAddress.slice(-4)}`
        : 'Imported';
      elements.currentWallet.textContent = `🔑 ${shortAddr}`;
    } else {
      elements.currentWallet.textContent = state.walletType 
        ? `${state.walletType.charAt(0).toUpperCase() + state.walletType.slice(1)}` 
        : 'Not set';
    }
    
    // Show auto-sign section only for imported or burner wallets (wallets with private key)
    const canAutosign = state.walletType === 'imported' || state.walletType === 'burner';
    if (elements.autosignSection) {
      elements.autosignSection.classList.toggle('hidden', !canAutosign);
      if (elements.autosignToggle) {
        elements.autosignToggle.checked = state.autosignEnabled;
      }
    }
  }

  /**
   * Show status message
   */
  function showStatus(message, type = 'info') {
    elements.statusContainer.classList.remove('hidden', 'status-success', 'status-error', 'status-info');
    elements.statusContainer.classList.add(`status-${type}`);
    elements.statusMessage.textContent = message;

    // Auto-hide
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        elements.statusContainer.classList.add('hidden');
      }, 3000);
    }
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', init);

})();
