/**
 * EIP-1193 Provider — Injected into page context
 * Exposes window.ethereum for dApp compatibility
 * SECURITY: Message origin restriction, no console leaks
 */

(function() {
  'use strict';
  
  // Prevent double-injection
  if (window.ethereum && window.ethereum.isSecureWallet) return;
  
  const PROVIDER_ID = 'secure-wallet-provider';
  let requestId = 0;
  const pendingRequests = new Map();
  
  // Connection state
  let connected = false;
  let accounts = [];
  let chainId = '0x1';
  
  // Event handlers
  const listeners = new Map();
  
  function emit(event, data) {
    const handlers = listeners.get(event) || [];
    handlers.forEach(h => {
      try { h(data); } catch (e) { /* silent */ }
    });
  }
  
  function postMessage(method, params = []) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pendingRequests.set(id, { 
        resolve, 
        reject, 
        timer: setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }, 60000) 
      });
      
      window.postMessage({
        source: PROVIDER_ID,
        id,
        method,
        params
      }, window.location.origin); // ✅ Restrict to same origin
    });
  }
  
  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return; // ✅ Validate origin
    if (!event.data || event.data.source !== 'secure-wallet-content') return;
    
    const { id, result, error } = event.data;
    const req = pendingRequests.get(id);
    if (!req) return;
    
    clearTimeout(req.timer);
    pendingRequests.delete(id);
    
    if (error) {
      req.reject(new Error(error));
    } else {
      req.resolve(result);
    }
  });
  
  // ─── EIP-1193 Provider Object ───
  const provider = {
    isSecureWallet: true,
    isMetaMask: false, // ✅ Don't pretend to be MetaMask (can cause issues)
    _events: listeners,
    
    // EIP-1193 required methods
    request: async ({ method, params = [] }) => {
      switch (method) {
        case 'eth_requestAccounts':
          const accResult = await postMessage('ETH_REQUEST_ACCOUNTS');
          accounts = accResult.accounts || [];
          if (accounts.length > 0) {
            connected = true;
            emit('connect', { chainId });
            emit('accountsChanged', accounts);
          }
          return accounts;
          
        case 'eth_accounts':
          return accounts;
          
        case 'eth_chainId':
          const chainResult = await postMessage('GET_CHAIN_ID');
          chainId = chainResult.chainId || '0x1';
          return chainId;
          
        case 'eth_sendTransaction':
          return await postMessage('ETH_SEND_TRANSACTION', params);
          
        case 'eth_sign':
        case 'personal_sign':
          return await postMessage('SIGN_MESSAGE', params);
          
        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4':
          return await postMessage('SIGN_TYPED_DATA', params);
          
        case 'wallet_switchEthereumChain':
          const switchResult = await postMessage('SWITCH_NETWORK', params);
          if (switchResult.success) {
            chainId = switchResult.chainId;
            emit('chainChanged', chainId);
          }
          return null;
          
        case 'wallet_addEthereumChain':
          throw new Error('wallet_addEthereumChain not supported');
          
        default:
          // Forward unknown methods to background
          return await postMessage(method, params);
      }
    },
    
    // EIP-1193 events
    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    
    removeListener: (event, handler) => {
      const handlers = listeners.get(event) || [];
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    },
    
    // Legacy MetaMask compatibility
    enable: async () => {
      return provider.request({ method: 'eth_requestAccounts' });
    },
    
    sendAsync: (payload, callback) => {
      provider.request({ method: payload.method, params: payload.params })
        .then(result => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
        .catch(error => callback(error));
    },
    
    send: (method, params) => {
      return provider.request({ method, params });
    }
  };
  
  // Inject into window
  window.ethereum = provider;
  
  // Dispatch ethereum#initialized event
  window.dispatchEvent(new Event('ethereum#initialized'));
  
  // No console.log in production — prevents detection
})();
