/**
 * Content Script — Injected into every page
 * Bridges dApp window.ethereum requests to background service worker
 */

// Inject the EIP-1193 provider into the page's JavaScript context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/provider.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected provider
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'secure-wallet-provider') return;
  
  const { id, method, params } = event.data;
  
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
    }, '*');
  } catch (error) {
    window.postMessage({
      source: 'secure-wallet-content',
      id,
      error: error.message
    }, '*');
  }
});
