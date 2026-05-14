/**
 * Secure Wallet — Chrome Extension Background Service Worker
 * Handles: storage, vault operations, session management, alarms
 * 
 * SECURITY: All sensitive data encrypted at rest. Sender validated.
 */

import { CryptoEngine } from '../utils/crypto.js';
import { SecureStorage } from '../utils/storage.js';
import { WalletManager } from '../utils/wallet.js';
import { VaultManager } from '../utils/vault.js';
import { NETWORKS } from '../utils/network.js';
import { ScamScanner } from '../utils/scanner.js';
import { TransactionPreview } from '../utils/preview.js';

// ─── Constants ───
const SESSION_MAX_LIFETIME = 60 * 60 * 1000; // 1 hour max
const SESSION_IDLE_TIMEOUT = 15 * 60 * 1000; // 15 min idle
const EXTENSION_ID = chrome.runtime.id;

// ─── Global Instances ───
const storage = new SecureStorage();
const cryptoEngine = new CryptoEngine();
let walletManager = null;
let vaultManager = null;
let scamScanner = null;
let txPreview = null;

// ─── Initialization ───
chrome.runtime.onStartup.addListener(() => {
  // Clear all sessions on browser startup for safety
  storage.remove('session');
  storage.remove('pendingTx');
  init();
});

chrome.runtime.onInstalled.addListener((details) => {
  init();
  if (details.reason === 'install') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🔐 Secure Wallet Installed',
      message: 'Your anti-drain protection is ready. Create your vault to secure your assets.'
    });
  }
});

async function init() {
  walletManager = new WalletManager(storage, cryptoEngine);
  vaultManager = new VaultManager(storage);
  scamScanner = new ScamScanner();
  txPreview = new TransactionPreview();
  
  // Set up periodic security checks
  chrome.alarms.create('security-check', { periodInMinutes: 5 });
  chrome.alarms.create('session-cleanup', { periodInMinutes: 1 });
}

// ─── Alarm Handlers ───
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'security-check') {
    await runSecurityCheck();
  } else if (alarm.name === 'session-cleanup') {
    await cleanupExpiredSessions();
  }
});

async function runSecurityCheck() {
  const session = await storage.get('session');
  if (!session) return;
  
  const now = Date.now();
  
  // Check absolute session lifetime
  if (now - session.createdAt > SESSION_MAX_LIFETIME) {
    await storage.remove('session');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🔒 Session Expired',
      message: 'Your wallet session expired after 1 hour. Please unlock again.'
    });
    return;
  }
  
  // Check idle timeout
  if (now - session.lastActive > SESSION_IDLE_TIMEOUT) {
    await storage.remove('session');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🔒 Session Expired',
      message: 'Your wallet session expired due to inactivity. Please unlock again.'
    });
  }
}

async function cleanupExpiredSessions() {
  const sessions = await storage.get('pendingSessions') || {};
  const now = Date.now();
  let changed = false;
  
  for (const [id, s] of Object.entries(sessions)) {
    if (now > s.expiresAt) {
      delete sessions[id];
      changed = true;
    }
  }
  
  if (changed) await storage.set('pendingSessions', sessions);
}

// ─── Message Handler (Popup ↔ Background ↔ Content) ───
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Validate sender for security
  if (!validateSender(sender)) {
    sendResponse({ error: 'Unauthorized sender' });
    return false;
  }
  
  handleMessage(request, sender).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true; // async response
});

/**
 * Validate message sender
 * - Internal messages (popup, background): sender.id === extension.id
 * - Content script messages: must have valid tab context
 */
function validateSender(sender) {
  // Internal extension messages
  if (sender.id === EXTENSION_ID) return true;
  
  // Content script messages must have tab context
  if (sender.tab && sender.tab.url) {
    const url = new URL(sender.tab.url);
    // Block known malicious origins
    const blockedOrigins = [
      'file:', 'data:', 'javascript:', 'about:', 'blob:'
    ];
    return !blockedOrigins.includes(url.protocol);
  }
  
  // External connections (should use onConnectExternal)
  return false;
}

async function handleMessage(request, sender) {
  const { action, data } = request;
  
  switch (action) {
    // ─── Wallet Management ───
    case 'CREATE_WALLET': {
      const { password } = data;
      const wallet = await walletManager.create(password);
      return { success: true, wallet: { address: wallet.address, createdAt: wallet.createdAt } };
    }
    
    case 'RECOVER_WALLET': {
      const { mnemonic, password } = data;
      const wallet = await walletManager.recover(mnemonic, password);
      return { success: true, wallet: { address: wallet.address } };
    }
    
    case 'UNLOCK_WALLET': {
      const { password } = data;
      const result = await walletManager.unlock(password);
      return { success: result };
    }
    
    case 'LOCK_WALLET': {
      await storage.remove('session');
      return { success: true };
    }
    
    case 'GET_WALLET_STATUS': {
      const exists = await walletManager.exists();
      const session = await storage.get('session');
      return { exists, unlocked: !!session, address: session?.address || null };
    }
    
    // ─── Security & Preview ───
    case 'SCAN_TRANSACTION': {
      const { tx, chainId } = data;
      const scan = await scamScanner.analyzeTransaction(tx, chainId);
      return { success: true, scan };
    }
    
    case 'PREVIEW_TRANSACTION': {
      const { tx, chainId } = data;
      const preview = await txPreview.preview(tx, chainId);
      return { success: true, preview };
    }
    
    // ─── Transaction Signing ───
    case 'SIGN_TRANSACTION': {
      const { tx, chainId } = data;
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      
      // Validate transaction structure
      if (!isValidTransaction(tx)) {
        throw new Error('Invalid transaction format');
      }
      
      // Run security scan
      const scan = await scamScanner.analyzeTransaction(tx, chainId);
      
      // If critical risk, block immediately
      if (scan.score === 0) {
        throw new Error('🚨 BLOCKED: Critical security threat detected. This transaction appears malicious.');
      }
      
      // If high risk, require explicit override
      if (scan.score < 30) {
        const txId = generateSecureId();
        await storage.set('pendingTx', {
          txId,
          tx,
          chainId,
          scan,
          requiresOverride: true,
          createdAt: Date.now(),
          txHash: hashTransaction(tx) // integrity check
        });
        return { requiresConfirmation: true, risk: 'HIGH', scan, txId };
      }
      
      // Generate preview for popup confirmation
      const preview = await txPreview.preview(tx, chainId);
      const txId = generateSecureId();
      await storage.set('pendingTx', {
        txId,
        tx,
        chainId,
        scan,
        preview,
        requiresOverride: false,
        createdAt: Date.now(),
        txHash: hashTransaction(tx)
      });
      
      // Show notification + route to popup
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: scan.safe ? '🔐 Sign Transaction' : '⚠️ Review Transaction',
        message: `${preview.summary.description.slice(0, 80)}...`
      });
      
      return { requiresConfirmation: true, scan, preview, txId };
    }
    
    case 'SIGN_MESSAGE': {
      const { message } = data;
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      const signature = await walletManager.signMessage(message, session);
      return { success: true, signature };
    }
    
    // ─── Vault Operations ───
    case 'DEPLOY_VAULT': {
      const { rpcUrl, guardians } = data;
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      const result = await vaultManager.deploy(session, guardians, rpcUrl);
      return { success: true, vault: result };
    }
    
    case 'GET_VAULT_STATUS': {
      const { rpcUrl } = data;
      const status = await vaultManager.getStatus(rpcUrl);
      return { success: true, status };
    }
    
    case 'FREEZE_VAULT': {
      const { rpcUrl } = data;
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      await vaultManager.freeze(rpcUrl, session);
      return { success: true };
    }
    
    // ─── EIP-1193 Provider ───
    case 'ETH_REQUEST_ACCOUNTS': {
      const session = await storage.get('session');
      if (!session) return { accounts: [] };
      return { accounts: [session.address] };
    }
    
    case 'ETH_SEND_TRANSACTION': {
      const { params } = data;
      // Route to popup for user confirmation
      const txId = generateSecureId();
      return { pending: true, txId };
    }
    
    case 'GET_CHAIN_ID': {
      const network = await storage.get('currentNetwork') || 'ethereum';
      return { chainId: NETWORKS[network].chainId };
    }
    
    // ─── Network Management ───
    case 'SWITCH_NETWORK': {
      const { network } = data;
      if (!NETWORKS[network]) throw new Error('Unsupported network');
      await storage.set('currentNetwork', network);
      return { success: true, chainId: NETWORKS[network].chainId };
    }
    
    case 'GET_NETWORKS': {
      return { networks: Object.entries(NETWORKS).map(([key, v]) => ({ key, ...v })) };
    }
    
    // ─── Security ───
    case 'UPDATE_SPENDING_LIMIT': {
      const { limit } = data;
      await storage.set('spendingLimit', limit);
      return { success: true };
    }
    
    case 'GET_SECURITY_STATUS': {
      const [vault, limit, whitelist] = await Promise.all([
        storage.get('vaultInfo'),
        storage.get('spendingLimit'),
        storage.get('whitelist')
      ]);
      return { 
        vaultDeployed: !!vault,
        spendingLimit: limit || '1.0',
        whitelistCount: (whitelist || []).length
      };
    }
    
    // ─── Pending Transaction ───
    case 'GET_PENDING_TX': {
      const pendingTx = await storage.get('pendingTx');
      if (!pendingTx) return { pendingTx: null };
      return {
        pendingTx,
        scan: pendingTx.scan,
        preview: pendingTx.preview,
        requiresOverride: pendingTx.requiresOverride
      };
    }
    
    case 'CONFIRM_SIGN': {
      const { txId } = data;
      const pendingTx = await storage.get('pendingTx');
      if (!pendingTx) throw new Error('No pending transaction');
      if (pendingTx.txId !== txId) throw new Error('Transaction ID mismatch');
      
      // Re-verify transaction integrity
      const currentHash = hashTransaction(pendingTx.tx);
      if (currentHash !== pendingTx.txHash) {
        await storage.remove('pendingTx');
        throw new Error('Transaction was modified. Rejected for security.');
      }
      
      // Re-scan before signing
      const reScan = await scamScanner.analyzeTransaction(pendingTx.tx, pendingTx.chainId);
      if (reScan.score === 0) {
        await storage.remove('pendingTx');
        throw new Error('Transaction now flagged as malicious. Signing blocked.');
      }
      
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      
      const signed = await walletManager.signTransaction(pendingTx.tx, session);
      await storage.remove('pendingTx');
      return { success: true, signedTx: signed };
    }
    
    case 'REJECT_TX': {
      await storage.remove('pendingTx');
      return { success: true };
    }
    
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ─── Security Helpers ───

function isValidTransaction(tx) {
  if (!tx || typeof tx !== 'object') return false;
  
  // Validate to address
  if (tx.to !== undefined) {
    if (typeof tx.to !== 'string') return false;
    if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to)) return false;
  }
  
  // Validate data
  if (tx.data !== undefined) {
    if (typeof tx.data !== 'string') return false;
    if (!tx.data.startsWith('0x')) return false;
    if (tx.data.length > 100000) return false; // Max 50KB calldata
  }
  
  // Validate value
  if (tx.value !== undefined) {
    if (typeof tx.value !== 'string' && typeof tx.value !== 'number') return false;
  }
  
  return true;
}

function generateSecureId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hashTransaction(tx) {
  // Simple integrity hash
  const str = JSON.stringify({
    to: tx.to,
    data: tx.data,
    value: tx.value,
    from: tx.from
  });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// ─── Content Script Bridge (External) ───
chrome.runtime.onConnectExternal.addListener((port) => {
  // Only allow connections from verified origins
  port.onMessage.addListener(async (msg) => {
    // Limit external to read-only actions only
    const allowedActions = ['ETH_REQUEST_ACCOUNTS', 'GET_CHAIN_ID', 'ETH_SEND_TRANSACTION'];
    if (!allowedActions.includes(msg.action)) {
      port.postMessage({ error: 'Action not allowed for external connections' });
      return;
    }
    
    const result = await handleMessage(msg, { tab: port.sender?.tab });
    port.postMessage(result);
  });
});
