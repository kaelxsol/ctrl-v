// Update checker utility for CTRL-V
// Checks GitHub releases for new versions

const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const GITHUB_REPO = 'kaelxsol/ctrl-v';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Compare semantic versions
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const parts1 = v1.replace('v', '').split('.').map(Number);
  const parts2 = v2.replace('v', '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Get current extension version from manifest
 */
function getCurrentVersion() {
  return chrome.runtime.getManifest().version;
}

/**
 * Check for updates from GitHub releases
 */
async function checkForUpdates() {
  try {
    console.log('[UpdateChecker] Checking for updates...');
    
    const response = await fetch(GITHUB_API, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'BetaLaunch-Extension'
      }
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const release = await response.json();
    const latestVersion = release.tag_name.replace('v', '');
    const currentVersion = getCurrentVersion();
    
    console.log(`[UpdateChecker] Current: v${currentVersion}, Latest: v${latestVersion}`);
    
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    
    const updateInfo = {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url,
      downloadUrl: release.assets?.[0]?.browser_download_url || release.html_url,
      releaseNotes: release.body || '',
      publishedAt: release.published_at,
      lastChecked: Date.now()
    };
    
    // Store update info
    await chrome.storage.local.set({ updateInfo });
    
    // Update badge if update available
    if (updateAvailable) {
      await showUpdateBadge();
    } else {
      await clearUpdateBadge();
    }
    
    return updateInfo;
    
  } catch (error) {
    console.error('[UpdateChecker] Error checking for updates:', error);
    return null;
  }
}

/**
 * Show update badge on extension icon
 */
async function showUpdateBadge() {
  try {
    await chrome.action.setBadgeText({ text: '1' });
    await chrome.action.setBadgeBackgroundColor({ color: '#00ff88' });
    await chrome.action.setTitle({ title: 'CTRL-V - Update Available!' });
  } catch (e) {
    console.error('[UpdateChecker] Error setting badge:', e);
  }
}

/**
 * Clear update badge
 */
async function clearUpdateBadge() {
  try {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'CTRL-V' });
  } catch (e) {
    console.error('[UpdateChecker] Error clearing badge:', e);
  }
}

/**
 * Dismiss the update notification (user chose to skip this version)
 */
async function dismissUpdate(version) {
  await chrome.storage.local.set({ 
    dismissedVersion: version,
    updateInfo: null 
  });
  await clearUpdateBadge();
}

/**
 * Get stored update info
 */
async function getUpdateInfo() {
  const result = await chrome.storage.local.get(['updateInfo', 'dismissedVersion']);
  
  // If this version was dismissed, don't show it again
  if (result.updateInfo && result.dismissedVersion === result.updateInfo.latestVersion) {
    return { ...result.updateInfo, updateAvailable: false };
  }
  
  return result.updateInfo;
}

/**
 * Schedule periodic update checks
 */
function scheduleUpdateChecks() {
  // Check on startup
  checkForUpdates();
  
  // Set up alarm for periodic checks (Chrome MV3 way)
  chrome.alarms.create('checkForUpdates', {
    periodInMinutes: 360 // 6 hours
  });
}

/**
 * Handle alarm for update check
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkForUpdates') {
    checkForUpdates();
  }
});

// Export for use in other scripts
if (typeof globalThis !== 'undefined') {
  globalThis.UpdateChecker = {
    checkForUpdates,
    getUpdateInfo,
    dismissUpdate,
    scheduleUpdateChecks,
    showUpdateBadge,
    clearUpdateBadge
  };
}
