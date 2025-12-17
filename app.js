// PushMe PWA - Main Application Logic

// Configuration
const CONFIG = {
  apiBaseUrl: 'https://3lxt16dul9.execute-api.ap-southeast-1.amazonaws.com',
  vapidPublicKey: null // Will be fetched from server
};

// State management
const state = {
  isPWA: false,
  swRegistration: null,
  pushSubscription: null,
  notificationPermission: 'default'
};

// Utility: Check if PWA is installed
function isPWAInstalled() {
  // Check for iOS standalone mode
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  
  // Check for display-mode: standalone (works on most browsers)
  const matchesStandalone = window.matchMedia('(display-mode: standalone)').matches;
  
  // For iOS, primarily check navigator.standalone
  const isPWA = isIOS ? isStandalone : (matchesStandalone || isStandalone);
  
  console.log('[App] PWA Detection:', {
    isIOS,
    isStandalone,
    matchesStandalone,
    isPWA,
    userAgent: navigator.userAgent.substring(0, 100)
  });
  
  return isPWA;
}

// Utility: Convert VAPID key from Base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Check browser support
function checkBrowserSupport() {
  const support = {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window
  };
  
  console.log('[App] Browser support:', support);
  
  if (!support.serviceWorker) {
    showError('Service Worker not supported in this browser');
    return false;
  }
  
  if (!support.pushManager) {
    showError('Push notifications not supported in this browser');
    return false;
  }
  
  if (!support.notification) {
    showError('Notifications not supported in this browser');
    return false;
  }
  
  return true;
}

// Register Service Worker
async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('[App] Service Worker registered:', registration);
    
    // Wait for Service Worker to be ready
    await navigator.serviceWorker.ready;
    console.log('[App] Service Worker ready');
    
    state.swRegistration = registration;
    return registration;
  } catch (error) {
    console.error('[App] Service Worker registration failed:', error);
    showError('Failed to register Service Worker: ' + error.message);
    throw error;
  }
}

// Fetch VAPID public key from server
async function fetchVapidPublicKey() {
  try {
    const response = await fetch(`${CONFIG.apiBaseUrl}/vapid-public-key`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    CONFIG.vapidPublicKey = data.publicKey;
    console.log('[App] VAPID public key fetched');
    return data.publicKey;
  } catch (error) {
    console.error('[App] Failed to fetch VAPID key:', error);
    showError('Failed to connect to server: ' + error.message);
    throw error;
  }
}

// Request notification permission
async function requestNotificationPermission() {
  console.log('[App] Requesting notification permission...');
  console.log('[App] Current permission:', Notification.permission);
  console.log('[App] isPWAInstalled:', isPWAInstalled());
  
  // Check if already granted
  if (Notification.permission === 'granted') {
    console.log('[App] Permission already granted');
    state.notificationPermission = 'granted';
    return true;
  }
  
  // iOS check - must be in PWA mode
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS && !window.navigator.standalone) {
    showError('On iOS, please open this app from Home Screen (not Safari)');
    console.error('[App] Not in standalone mode on iOS');
    return false;
  }
  
  try {
    console.log('[App] Calling Notification.requestPermission()...');
    const permission = await Notification.requestPermission();
    state.notificationPermission = permission;
    console.log('[App] Permission result:', permission);
    
    if (permission === 'granted') {
      showSuccess('Notification permission granted!');
      return true;
    } else if (permission === 'denied') {
      showError('Notification permission denied. Go to Settings → Safari → PushMe to enable.');
      return false;
    } else {
      showError('Notification permission not granted');
      return false;
    }
  } catch (error) {
    console.error('[App] Permission request failed:', error);
    showError('Failed to request permission: ' + error.message);
    throw error;
  }
}

// Subscribe to push notifications
async function subscribeToPush() {
  try {
    console.log('[App] Starting push subscription...');
    
    if (!state.swRegistration) {
      throw new Error('Service Worker not registered');
    }
    console.log('[App] Service Worker OK');
    
    if (!CONFIG.vapidPublicKey) {
      console.log('[App] Fetching VAPID key...');
      await fetchVapidPublicKey();
    }
    console.log('[App] VAPID key available');
    
    // Check existing subscription
    let subscription = await state.swRegistration.pushManager.getSubscription();
    
    if (subscription) {
      console.log('[App] Already subscribed:', subscription.endpoint);
      state.pushSubscription = subscription;
      showSuccess('Already subscribed to notifications!');
      return subscription;
    }
    
    console.log('[App] Creating new subscription...');
    
    // Create new subscription
    const applicationServerKey = urlBase64ToUint8Array(CONFIG.vapidPublicKey);
    
    subscription = await state.swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    });
    
    console.log('[App] Push subscription created:', {
      endpoint: subscription.endpoint,
      keys: subscription.toJSON().keys
    });
    
    state.pushSubscription = subscription;
    
    // Send subscription to server
    console.log('[App] Sending subscription to server...');
    await sendSubscriptionToServer(subscription);
    console.log('[App] Subscription complete!');
    
    showSuccess('Successfully subscribed to notifications!');
    
    return subscription;
  } catch (error) {
    console.error('[App] Push subscription failed:', error);
    console.error('[App] Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    let errorMsg = 'Failed to subscribe: ' + error.message;
    
    // Specific error messages
    if (error.name === 'NotAllowedError') {
      errorMsg = 'Notification permission was denied. Please enable in Settings.';
    } else if (error.name === 'NotSupportedError') {
      errorMsg = 'Push notifications not supported on this device/browser.';
    } else if (error.message.includes('VAPID')) {
      errorMsg = 'Failed to connect to server. Please try again.';
    }
    
    showError(errorMsg);
    throw error;
  }
}

// Send subscription to backend
async function sendSubscriptionToServer(subscription) {
  try {
    const response = await fetch(`${CONFIG.apiBaseUrl}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userId: getUserId() // Optional: if you have user identification
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[App] Subscription saved:', data);
    
    // Store subscription ID locally
    if (data.subscriptionId) {
      localStorage.setItem('pushme_subscription_id', data.subscriptionId);
    }
    
    return data;
  } catch (error) {
    console.error('[App] Failed to send subscription to server:', error);
    throw error;
  }
}

// Unsubscribe from push notifications
async function unsubscribeFromPush() {
  try {
    if (!state.pushSubscription) {
      console.log('[App] No active subscription');
      return;
    }
    
    // Unsubscribe from browser
    await state.pushSubscription.unsubscribe();
    console.log('[App] Unsubscribed from push');
    
    // Delete from server
    const subscriptionId = localStorage.getItem('pushme_subscription_id');
    if (subscriptionId) {
      await fetch(`${CONFIG.apiBaseUrl}/subscribe/${subscriptionId}`, {
        method: 'DELETE'
      });
      localStorage.removeItem('pushme_subscription_id');
    }
    
    state.pushSubscription = null;
    showSuccess('Unsubscribed from notifications');
    updateUI();
  } catch (error) {
    console.error('[App] Unsubscribe failed:', error);
    showError('Failed to unsubscribe: ' + error.message);
  }
}

// Get or generate user ID (for demo purposes)
function getUserId() {
  let userId = localStorage.getItem('pushme_user_id');
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('pushme_user_id', userId);
  }
  return userId;
}

// UI Update Functions
function updateUI() {
  state.isPWA = isPWAInstalled();
  state.notificationPermission = Notification.permission;
  
  console.log('[App] Updating UI, state:', {
    isPWA: state.isPWA,
    notificationPermission: state.notificationPermission
  });
  
  // Update PWA status
  const installPrompt = document.getElementById('install-prompt');
  const notificationSection = document.getElementById('notification-section');
  const statusText = document.getElementById('pwa-status');
  
  if (state.isPWA) {
    console.log('[App] Showing notification section');
    installPrompt.style.display = 'none';
    notificationSection.style.display = 'block';
    if (statusText) {
      statusText.textContent = '✓ Installed as PWA';
      statusText.className = 'status-text success';
    }
  } else {
    console.log('[App] Showing install prompt');
    installPrompt.style.display = 'block';
    notificationSection.style.display = 'none';
  }
  
  // Update notification permission status
  const permissionStatus = document.getElementById('permission-status');
  const enableBtn = document.getElementById('enable-notifications');
  const disableBtn = document.getElementById('disable-notifications');
  const subscriptionInfo = document.getElementById('subscription-info');
  
  if (state.notificationPermission === 'granted') {
    permissionStatus.textContent = '✓ Notification permission granted';
    permissionStatus.className = 'status-text success';
    enableBtn.style.display = 'none';
    disableBtn.style.display = state.pushSubscription ? 'inline-block' : 'none';
    
    if (state.pushSubscription) {
      subscriptionInfo.style.display = 'block';
      subscriptionInfo.textContent = '✓ Subscribed to push notifications';
    } else {
      subscriptionInfo.style.display = 'none';
    }
  } else if (state.notificationPermission === 'denied') {
    permissionStatus.textContent = '✗ Notification permission denied';
    permissionStatus.className = 'status-text error';
    enableBtn.style.display = 'none';
    disableBtn.style.display = 'none';
  } else {
    permissionStatus.textContent = '⚠ Notification permission not requested';
    permissionStatus.className = 'status-text warning';
    enableBtn.style.display = 'inline-block';
    disableBtn.style.display = 'none';
  }
}

// UI Feedback
function showError(message) {
  showMessage(message, 'error');
}

function showSuccess(message) {
  showMessage(message, 'success');
}

function showMessage(message, type = 'info') {
  const messageDiv = document.getElementById('message');
  messageDiv.textContent = message;
  messageDiv.className = `message ${type}`;
  messageDiv.style.display = 'block';
  
  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 5000);
}

// Event Handlers
async function handleEnableNotifications() {
  const btn = document.getElementById('enable-notifications');
  btn.disabled = true;
  btn.textContent = 'Enabling...';
  
  try {
    const granted = await requestNotificationPermission();
    if (granted) {
      await subscribeToPush();
      showSuccess('Notifications enabled successfully!');
    }
  } catch (error) {
    console.error('[App] Enable notifications failed:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enable Notifications';
    updateUI();
  }
}

async function handleDisableNotifications() {
  if (confirm('Are you sure you want to disable notifications?')) {
    await unsubscribeFromPush();
  }
}

// Initialize app
async function init() {
  console.log('[App] Initializing...');
  
  // Check browser support
  if (!checkBrowserSupport()) {
    return;
  }
  
  try {
    // Register Service Worker
    await registerServiceWorker();
    
    // Check existing subscription
    if (state.swRegistration) {
      const subscription = await state.swRegistration.pushManager.getSubscription();
      state.pushSubscription = subscription;
    }
    
    // Update UI
    updateUI();
    
    // Fetch VAPID key in background
    fetchVapidPublicKey().catch(console.error);
    
    console.log('[App] Initialization complete');
  } catch (error) {
    console.error('[App] Initialization failed:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('enable-notifications')?.addEventListener('click', handleEnableNotifications);
  document.getElementById('disable-notifications')?.addEventListener('click', handleDisableNotifications);
  
  // Listen for app visibility changes
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateUI();
    }
  });
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    init();
  });
} else {
  setupEventListeners();
  init();
}
