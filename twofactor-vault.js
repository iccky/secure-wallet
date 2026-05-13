import { ethers } from 'ethers';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = './data';
const VAULT_FILE = path.join(DATA_DIR, 'twofactor-vault.json');

/**
 * Deterministically derive a guardian key from a password.
 * Uses PBKDF2-HMAC-SHA512 → ECDSA private key.
 * This ensures the same password always produces the same guardian address,
 * but the guardian key CANNOT be derived from the seed phrase.
 */
export function deriveGuardianKey(password) {
  // 600k iterations for brute-force resistance
  const derived = crypto.pbkdf2Sync(password, 'SECURE_WALLET_GUARDIAN_v1', 600000, 32, 'sha512');
  // Use as Ethereum private key
  const privateKey = '0x' + derived.toString('hex');
  const wallet = new ethers.Wallet(privateKey);
  return {
    privateKey,
    address: wallet.address
  };
}

/**
 * Load vault info from disk
 */
export async function loadVaultInfo() {
  try {
    const data = await fs.readFile(VAULT_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveVaultInfo(info) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(VAULT_FILE, JSON.stringify(info, null, 2));
}

/**
 * Get the TwoFactorVault contract instance
 */
export async function getVaultContract(rpcUrl) {
  const vaultInfo = await loadVaultInfo();
  if (!vaultInfo) throw new Error('No vault deployed. Create one first.');
  
  const abi = JSON.parse(await fs.readFile('./contracts/TwoFactorVault.json', 'utf8')).abi;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Contract(vaultInfo.address, abi, provider);
}

/**
 * Build the transaction hash that BOTH signers must sign
 */
export function buildTxHash(contractAddress, to, value, data, nonce) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256', 'bytes', 'uint256'],
      [contractAddress, to, value, data, nonce]
    )
  );
}

/**
 * Sign transaction hash with a key
 */
export async function signTxHash(txHash, privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.signMessage(ethers.getBytes(txHash));
}

/**
 * Deploy a new TwoFactorVault contract
 * @param {string} ownerPrivateKey - The seed phrase wallet's private key
 * @param {string} guardianAddress - The guardian address (derived from secondary password)
 * @param {string} rpcUrl - RPC endpoint
 */
export async function deployVault(ownerPrivateKey, guardianAddress, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const abi = JSON.parse(await fs.readFile('./contracts/TwoFactorVault.json', 'utf8')).abi;
  const bytecode = JSON.parse(await fs.readFile('./contracts/TwoFactorVault.json', 'utf8')).evm.bytecode.object;
  
  const factory = new ethers.ContractFactory(abi, '0x' + bytecode, ownerWallet);
  const contract = await factory.deploy(ownerWallet.address, guardianAddress);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  
  await saveVaultInfo({
    address,
    owner: ownerWallet.address,
    guardian: guardianAddress,
    deployedAt: new Date().toISOString()
  });
  
  return { address };
}

/**
 * Execute a transaction from the vault (requires BOTH signatures)
 * @param {string} ownerPrivateKey - Seed phrase wallet private key
 * @param {string} guardianPassword - Secondary password (to derive guardian key)
 * @param {string} to - Recipient
 * @param {string} amountEth - Amount in ETH
 * @param {string} rpcUrl - RPC endpoint
 */
export async function executeFromVault(ownerPrivateKey, guardianPassword, to, amountEth, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const vault = await getVaultContract(rpcUrl);
  
  // Get current nonce from contract
  const nonce = await vault.nonce();
  const value = ethers.parseEther(amountEth);
  const data = '0x';
  
  // Build transaction hash
  const txHash = buildTxHash(await vault.getAddress(), to, value, data, nonce);
  
  // Sign with owner key
  const ownerSig = await signTxHash(txHash, ownerPrivateKey);
  
  // Derive guardian key from password and sign
  const guardian = deriveGuardianKey(guardianPassword);
  const guardianSig = await signTxHash(txHash, guardian.privateKey);
  
  // Execute (can be called by anyone, signatures are verified on-chain)
  const tx = await vault.execute(to, value, data, ownerSig, guardianSig);
  await tx.wait();
  
  return tx.hash;
}

/**
 * Deposit ETH into the vault
 */
export async function depositToVault(privateKey, rpcUrl, amountEth) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = await getVaultContract(rpcUrl);
  
  const tx = await vault.connect(wallet).deposit({ value: ethers.parseEther(amountEth) });
  await tx.wait();
  return tx.hash;
}

/**
 * Get vault balance
 */
export async function getVaultBalance(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.getBalance();
}

/**
 * Get vault nonce
 */
export async function getVaultNonce(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.nonce();
}
