/**
 * Secure Wallet — Chrome Extension Background Service Worker
 * Handles: storage, vault operations, session management, alarms
 */

import { CryptoEngine } from '../utils/crypto.js';
import { SecureStorage } from '../utils/storage.js';
import { WalletManager } from '../utils/wallet.js';
import { VaultManager } from '../utils/vault.js';
import { NETWORKS } from '../utils/network.js';
import { ScamScanner } from '../utils/scanner.js';
import { TransactionPreview } from '../utils/preview.js';

// ─── Global Instances ───
const storage = new SecureStorage();
const crypto = new CryptoEngine();
let walletManager = null;
let vaultManager = null;
let scamScanner = null;
let txPreview = null;

// ─── Initialization ───
chrome.runtime.onStartup.addListener(init);
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
  walletManager = new WalletManager(storage, crypto);
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
  if (now - session.lastActive > 15 * 60 * 1000) { // 15 min idle
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
  handleMessage(request, sender).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true; // async response
});

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
      
      // Run security scan
      const scan = await scamScanner.analyzeTransaction(tx, chainId);
      
      // If critical risk, block immediately
      if (scan.score === 0) {
        throw new Error('🚨 BLOCKED: Critical security threat detected. This transaction appears malicious.');
      }
      
      // If high risk, require explicit override
      if (scan.score < 30) {
        // Store pending tx with risk flag for popup to handle
        await storage.set('pendingTx', {
          tx, chainId, scan,
          requiresOverride: true,
          createdAt: Date.now()
        });
        return { requiresConfirmation: true, risk: 'HIGH', scan };
      }
      
      // Generate preview for popup confirmation
      const preview = await txPreview.preview(tx, chainId);
      await storage.set('pendingTx', {
        tx, chainId, scan, preview,
        requiresOverride: false,
        createdAt: Date.now()
      });
      
      // Show notification + route to popup
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: scan.safe ? '🔐 Sign Transaction' : '⚠️ Review Transaction',
        message: `${preview.summary.description.slice(0, 80)}...`
      });
      
      return { requiresConfirmation: true, scan, preview };
    }
    
    case 'SIGN_MESSAGE': {
      const { message } = data;
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      const signature = await walletManager.signMessage(message, session.privateKey);
      return { success: true, signature };
    }
    
    // ─── Vault Operations ───
    case 'DEPLOY_VAULT': {
      const { rpcUrl, guardians } = data;
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      const result = await vaultManager.deploy(session.privateKey, guardians, rpcUrl);
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
      await vaultManager.freeze(rpcUrl, session.privateKey);
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
      return { pending: true, txId: Date.now().toString() };
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
      
      const session = await storage.get('session');
      if (!session) throw new Error('Wallet locked');
      
      const signed = await walletManager.signTransaction(pendingTx.tx, session.privateKey);
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

// ─── Content Script Bridge ───
chrome.runtime.onConnectExternal.addListener((port) => {
  port.onMessage.addListener(async (msg) => {
    const result = await handleMessage(msg, { tab: port.sender?.tab });
    port.postMessage(result);
  });
});
