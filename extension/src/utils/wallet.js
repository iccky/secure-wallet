/**
 * Wallet Manager — Create, recover, unlock EOA wallet
 */

import { CryptoEngine } from './crypto.js';

export class WalletManager {
  constructor(storage, crypto) {
    this.storage = storage;
    this.crypto = crypto;
  }

  async exists() {
    const wallet = await this.storage.getRaw('wallet');
    return !!wallet;
  }

  async create(password) {
    // Generate mnemonic using ethers.js (loaded dynamically)
    const ethers = await loadEthers();
    const wallet = ethers.Wallet.createRandom();
    
    const encryptedPk = await this.crypto.encrypt(wallet.privateKey, password);
    const passwordHash = await this.crypto.hashPassword(password);
    
    const walletData = {
      address: wallet.address,
      mnemonic: wallet.mnemonic.phrase,
      encryptedPrivateKey: encryptedPk,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    
    await this.storage.setRaw('wallet', JSON.stringify(walletData));
    await this._createSession(wallet.privateKey, wallet.address);
    
    return walletData;
  }

  async recover(mnemonic, password) {
    const ethers = await loadEthers();
    const wallet = ethers.Wallet.fromPhrase(mnemonic);
    
    const encryptedPk = await this.crypto.encrypt(wallet.privateKey, password);
    const passwordHash = await this.crypto.hashPassword(password);
    
    const walletData = {
      address: wallet.address,
      mnemonic,
      encryptedPrivateKey: encryptedPk,
      passwordHash,
      createdAt: new Date().toISOString(),
      recoveredAt: new Date().toISOString()
    };
    
    await this.storage.setRaw('wallet', JSON.stringify(walletData));
    await this._createSession(wallet.privateKey, wallet.address);
    
    return walletData;
  }

  async unlock(password) {
    const raw = await this.storage.getRaw('wallet');
    if (!raw) return false;
    
    const walletData = JSON.parse(raw);
    const valid = await this.crypto.verifyPassword(password, walletData.passwordHash);
    if (!valid) return false;
    
    const privateKey = await this.crypto.decrypt(walletData.encryptedPrivateKey, password);
    await this._createSession(privateKey, walletData.address);
    
    return true;
  }

  async _createSession(privateKey, address) {
    await this.storage.set('session', {
      address,
      privateKey,
      createdAt: Date.now(),
      lastActive: Date.now()
    });
  }

  async signTransaction(tx, privateKey) {
    const ethers = await loadEthers();
    const wallet = new ethers.Wallet(privateKey);
    // Would connect to provider and sign
    return { signed: true, hash: '0x...' };
  }

  async signMessage(message, privateKey) {
    const ethers = await loadEthers();
    const wallet = new ethers.Wallet(privateKey);
    return await wallet.signMessage(message);
  }
}

/**
 * Dynamic Ethers.js loader for extension context
 */
async function loadEthers() {
  // In production, bundle ethers.min.js or load from trusted CDN
  if (typeof ethers !== 'undefined') return ethers;
  
  // For now, assume ethers is injected via manifest or loaded via offscreen
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ethers-6.13.umd.min.js');
    script.onload = () => resolve(window.ethers);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
