import { ethers } from 'ethers';
import {
  createWallet as cryptoCreate,
  recoverWallet as cryptoRecover,
  signTransaction as cryptoSign,
  sendTransaction as cryptoSend,
  verifyPassword
} from './crypto-engine.js';
import { loadWallet, saveWallet, deleteWallet, logTransaction, loadSettings } from './storage.js';

class WalletManager {
  constructor() {
    this._provider = null;
    this._settings = null;
  }

  async _getProvider() {
    if (!this._provider) {
      this._settings = await loadSettings();
      this._provider = new ethers.JsonRpcProvider(this._settings.rpcUrl);
    }
    return this._provider;
  }

  async getSettings() {
    if (!this._settings) this._settings = await loadSettings();
    return this._settings;
  }

  async setSettings(rpcUrl, chainId) {
    this._settings = { rpcUrl, chainId: Number(chainId) };
    await (await import('./storage.js')).saveSettings(this._settings);
    this._provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async walletExists() {
    const w = await loadWallet();
    return !!w;
  }

  async getWalletInfo() {
    const w = await loadWallet();
    if (!w) return null;
    const provider = await this._getProvider();
    const balance = await provider.getBalance(w.address);
    return {
      address: w.address,
      balance: ethers.formatEther(balance),
      balanceWei: balance.toString(),
      createdAt: w.createdAt,
      recoveredAt: w.recoveredAt || null
    };
  }

  async createWallet(secondaryPassword) {
    if (await this.walletExists()) {
      throw new Error('Wallet already exists. Delete it first or recover from mnemonic.');
    }
    const wallet = await cryptoCreate(secondaryPassword);
    await saveWallet(wallet);
    return {
      address: wallet.address,
      mnemonic: wallet.mnemonic,
      warning: 'BACKUP THIS MNEMONIC NOW. It is the ONLY way to recover your wallet.'
    };
  }

  async recoverWallet(mnemonic, secondaryPassword) {
    const wallet = await cryptoRecover(mnemonic, secondaryPassword);
    await saveWallet(wallet);
    return { address: wallet.address };
  }

  async deleteWallet() {
    await deleteWallet();
  }

  async signTransaction(secondaryPassword, txRequest) {
    const w = await loadWallet();
    if (!w) throw new Error('No wallet found.');
    const provider = await this._getProvider();

    // Add network params if missing
    const nonce = await provider.getTransactionCount(w.address);
    const feeData = await provider.getFeeData();

    const tx = {
      to: txRequest.to,
      value: ethers.parseEther(txRequest.amount || '0'),
      nonce,
      gasLimit: txRequest.gasLimit || 21000,
      ...feeData,
      chainId: (await this.getSettings()).chainId
    };

    if (txRequest.data) tx.data = txRequest.data;

    const signedTx = await cryptoSign(w.encryptedPrivateKey, secondaryPassword, w.passwordHash, tx, provider);
    return signedTx;
  }

  async sendTransaction(secondaryPassword, txRequest) {
    const w = await loadWallet();
    if (!w) throw new Error('No wallet found.');
    const provider = await this._getProvider();

    const nonce = await provider.getTransactionCount(w.address);
    const feeData = await provider.getFeeData();

    const tx = {
      to: txRequest.to,
      value: ethers.parseEther(txRequest.amount || '0'),
      nonce,
      gasLimit: txRequest.gasLimit || 21000,
      ...feeData,
      chainId: (await this.getSettings()).chainId
    };

    if (txRequest.data) tx.data = txRequest.data;

    const response = await cryptoSend(w.encryptedPrivateKey, secondaryPassword, w.passwordHash, tx, provider);

    await logTransaction({
      hash: response.hash,
      to: txRequest.to,
      amount: txRequest.amount,
      nonce,
      status: 'pending'
    });

    return {
      hash: response.hash,
      nonce,
      to: txRequest.to,
      amount: txRequest.amount,
      explorer: `https://${(await this.getSettings()).chainId === 1 ? 'etherscan.io' : 'blockscout.com'}/tx/${response.hash}`
    };
  }

  async getTxHistory() {
    const logs = await (await import('./storage.js')).loadTxLogs();
    return logs;
  }

  async verifySecondaryPassword(password) {
    const w = await loadWallet();
    if (!w) throw new Error('No wallet found.');
    return verifyPassword(password, w.passwordHash);
  }
}

export default new WalletManager();
