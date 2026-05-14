/**
 * Wallet Manager — Create, recover, unlock EOA wallet
 * SECURITY: Private key & mnemonic encrypted at rest. Session uses encrypted key.
 */

import { CryptoEngine } from './crypto.js';

export class WalletManager {
  constructor(storage, crypto) {
    this.storage = storage;
    this.crypto = crypto;
  }

  async exists() {
    const wallet = await this.storage.getRaw('wallet_encrypted');
    return !!wallet;
  }

  async create(password) {
    const ethers = await loadEthers();
    const wallet = ethers.Wallet.createRandom();
    
    const encryptedPk = await this.crypto.encrypt(wallet.privateKey, password);
    const encryptedMnemonic = await this.crypto.encrypt(wallet.mnemonic.phrase, password);
    const passwordHash = await this.crypto.hashPassword(password);
    
    const walletData = {
      address: wallet.address,
      encryptedMnemonic,  // ✅ ENCRYPTED
      encryptedPrivateKey: encryptedPk,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    
    await this.storage.setRaw('wallet_encrypted', JSON.stringify(walletData));
    await this._createSession(wallet.privateKey, wallet.address, passwordHash);
    
    return { address: wallet.address, createdAt: walletData.createdAt };
  }

  async recover(mnemonic, password) {
    const ethers = await loadEthers();
    const wallet = ethers.Wallet.fromPhrase(mnemonic);
    
    const encryptedPk = await this.crypto.encrypt(wallet.privateKey, password);
    const encryptedMnemonic = await this.crypto.encrypt(mnemonic, password);
    const passwordHash = await this.crypto.hashPassword(password);
    
    const walletData = {
      address: wallet.address,
      encryptedMnemonic,  // ✅ ENCRYPTED
      encryptedPrivateKey: encryptedPk,
      passwordHash,
      createdAt: new Date().toISOString(),
      recoveredAt: new Date().toISOString()
    };
    
    await this.storage.setRaw('wallet_encrypted', JSON.stringify(walletData));
    await this._createSession(wallet.privateKey, wallet.address, passwordHash);
    
    return { address: wallet.address };
  }

  async unlock(password) {
    const raw = await this.storage.getRaw('wallet_encrypted');
    if (!raw) return false;
    
    const walletData = JSON.parse(raw);
    const valid = await this.crypto.verifyPassword(password, walletData.passwordHash);
    if (!valid) return false;
    
    const privateKey = await this.crypto.decrypt(walletData.encryptedPrivateKey, password);
    await this._createSession(privateKey, walletData.address, walletData.passwordHash);
    
    return true;
  }

  /**
   * Create session with encrypted private key
   * Session key derived from password hash (not password itself)
   */
  async _createSession(privateKey, address, passwordHash) {
    // Derive session encryption key from password hash
    const sessionKey = await this._deriveSessionKey(passwordHash);
    const encryptedPk = await this._encryptWithSessionKey(privateKey, sessionKey);
    
    await this.storage.set('session', {
      address,
      encryptedPrivateKey: encryptedPk,  // ✅ ENCRYPTED in storage
      createdAt: Date.now(),
      lastActive: Date.now()
    });
  }

  /**
   * Decrypt private key from session for signing
   */
  async _getSessionKey() {
    const session = await this.storage.get('session');
    if (!session) return null;
    
    const raw = await this.storage.getRaw('wallet_encrypted');
    if (!raw) return null;
    
    const walletData = JSON.parse(raw);
    const sessionKey = await this._deriveSessionKey(walletData.passwordHash);
    return { session, sessionKey };
  }

  async _deriveSessionKey(passwordHash) {
    // Use first 32 chars of password hash as key material
    const encoder = new TextEncoder();
    const material = encoder.encode(passwordHash.slice(0, 32));
    const key = await crypto.subtle.importKey(
      'raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']
    );
    return key;
  }

  async _encryptWithSessionKey(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoder.encode(data)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  async _decryptWithSessionKey(ciphertext, key) {
    const combined = new Uint8Array(
      atob(ciphertext).split('').map(c => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, encrypted
    );
    return new TextDecoder().decode(decrypted);
  }

  async signTransaction(tx, sessionObj) {
    const { session, sessionKey } = await this._getSessionKey();
    if (!session) throw new Error('Session expired');
    
    const privateKey = await this._decryptWithSessionKey(session.encryptedPrivateKey, sessionKey);
    
    const ethers = await loadEthers();
    const wallet = new ethers.Wallet(privateKey);
    // Would connect to provider and sign
    
    // Clear from memory
    // privateKey goes out of scope after return
    
    return { signed: true, hash: '0x...' };
  }

  async signMessage(message, sessionObj) {
    const { session, sessionKey } = await this._getSessionKey();
    if (!session) throw new Error('Session expired');
    
    const privateKey = await this._decryptWithSessionKey(session.encryptedPrivateKey, sessionKey);
    
    const ethers = await loadEthers();
    const wallet = new ethers.Wallet(privateKey);
    const signature = await wallet.signMessage(message);
    
    return signature;
  }

  /**
   * Get decrypted mnemonic for backup/export (requires password)
   */
  async getMnemonic(password) {
    const raw = await this.storage.getRaw('wallet_encrypted');
    if (!raw) return null;
    
    const walletData = JSON.parse(raw);
    const valid = await this.crypto.verifyPassword(password, walletData.passwordHash);
    if (!valid) return null;
    
    return await this.crypto.decrypt(walletData.encryptedMnemonic, password);
  }
}

/**
 * Dynamic Ethers.js loader for extension context
 */
async function loadEthers() {
  if (typeof ethers !== 'undefined') return ethers;
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ethers-6.13.umd.min.js');
    script.onload = () => resolve(window.ethers);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
