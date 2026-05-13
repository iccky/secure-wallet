import { ethers } from 'ethers';
import {
  deriveGuardianKey,
  buildTxHash,
  signTxHash,
  deployVault,
  executeFromVault,
  depositToVault,
  getVaultBalance,
  getVaultNonce,
  loadVaultInfo,
  saveVaultInfo,
  getVaultContract
} from './twofactor-vault.js';
import { loadWallet, saveSettings, loadSettings } from './storage.js';
import { decrypt } from './crypto-engine.js';

/**
 * TwoFactorVault Manager
 * Coordinates the dual-signature vault system.
 */
class TwoFactorManager {
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

  /**
   * Check if vault exists
   */
  async vaultExists() {
    const info = await loadVaultInfo();
    return !!info;
  }

  /**
   * Get vault summary
   */
  async getVaultSummary() {
    const info = await loadVaultInfo();
    if (!info) return null;
    
    const provider = await this._getProvider();
    const balance = await provider.getBalance(info.address);
    const vault = await getVaultContract(this._settings.rpcUrl);
    const nonce = await vault.nonce();
    
    return {
      address: info.address,
      owner: info.owner,
      guardian: info.guardian,
      balance: ethers.formatEther(balance),
      balanceWei: balance.toString(),
      nonce: Number(nonce),
      deployedAt: info.deployedAt
    };
  }

  /**
   * Create a new TwoFactorVault.
   * Requires: secondary password (derives guardian key).
   * Owner key comes from existing wallet.
   */
  async createVault(secondaryPassword) {
    const walletData = await loadWallet();
    if (!walletData) throw new Error('Create a regular wallet first');
    
    const vaultInfo = await loadVaultInfo();
    if (vaultInfo) throw new Error('Vault already exists');
    
    // Derive guardian key from secondary password
    const guardian = deriveGuardianKey(secondaryPassword);
    
    // Get owner private key (decrypt with secondary password)
    const ownerPrivateKey = decrypt(walletData.encryptedPrivateKey, secondaryPassword);
    
    // Deploy vault
    const { address } = await deployVault(ownerPrivateKey, guardian.address, this._settings.rpcUrl);
    
    // Clear sensitive data
    ownerPrivateKey = null;
    
    return {
      vaultAddress: address,
      owner: walletData.address,
      guardian: guardian.address,
      warning: 'Deposit funds to this vault address. They can only be spent with BOTH signatures.'
    };
  }

  /**
   * Deposit ETH into the vault
   */
  async deposit(amountEth, secondaryPassword) {
    const walletData = await loadWallet();
    if (!walletData) throw new Error('No wallet');
    
    const privateKey = decrypt(walletData.encryptedPrivateKey, secondaryPassword);
    const hash = await depositToVault(privateKey, this._settings.rpcUrl, amountEth);
    privateKey = null;
    
    return { hash };
  }

  /**
   * Withdraw from vault — requires BOTH owner + guardian signatures
   */
  async withdraw(to, amountEth, secondaryPassword) {
    const walletData = await loadWallet();
    if (!walletData) throw new Error('No wallet');
    
    const ownerPrivateKey = decrypt(walletData.encryptedPrivateKey, secondaryPassword);
    
    const hash = await executeFromVault(
      ownerPrivateKey,
      secondaryPassword,
      to,
      amountEth,
      this._settings.rpcUrl
    );
    
    ownerPrivateKey = null;
    return { hash };
  }

  /**
   * Verify that a secondary password can derive the correct guardian key
   */
  async verifyGuardianPassword(secondaryPassword) {
    const info = await loadVaultInfo();
    if (!info) throw new Error('No vault');
    
    const guardian = deriveGuardianKey(secondaryPassword);
    return guardian.address.toLowerCase() === info.guardian.toLowerCase();
  }
}

export default new TwoFactorManager();
