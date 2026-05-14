/**
 * Content Script — Injected into every page
 * Bridges dApp window.ethereum requests to background service worker
 * SECURITY: Origin validation, message filtering
 */

// Inject the EIP-1193 provider into the page's JavaScript context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/provider.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected provider
window.addEventListener('message', async (event) => {
  // ✅ SECURITY: Validate event origin matches current page
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  
  if (!event.data || event.data.source !== 'secure-wallet-provider') return;
  
  const { id, method, params } = event.data;
  
  // ✅ SECURITY: Validate method is allowed
  const allowedMethods = [
    'ETH_REQUEST_ACCOUNTS', 'ETH_SEND_TRANSACTION', 'GET_CHAIN_ID',
    'SWITCH_NETWORK', 'SIGN_MESSAGE', 'SIGN_TYPED_DATA',
    'SCAN_TRANSACTION', 'PREVIEW_TRANSACTION'
  ];
  if (!allowedMethods.includes(method)) {
    window.postMessage({
      source: 'secure-wallet-content',
      id,
      error: 'Method not allowed'
    }, window.location.origin);
    return;
  }
  
  try {
    // Forward to background service worker
    const response = await chrome.runtime.sendMessage({
      action: method,
      data: { params, method }
    });
    
    window.postMessage({
      source: 'secure-wallet-content',
      id,
      result: response
    }, window.location.origin); // ✅ Restrict target origin
  } catch (error) {
    window.postMessage({
      source: 'secure-wallet-content',
      id,
      error: error.message
    }, window.location.origin);
  }
});
