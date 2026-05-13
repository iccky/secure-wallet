import { ethers } from 'ethers';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = './data';
const VAULT_FILE = path.join(DATA_DIR, 'antidrain-vault.json');

// ─── Guardian Key Derivation ───
export function deriveGuardianKey(password) {
  const derived = crypto.pbkdf2Sync(password, 'SECURE_WALLET_GUARDIAN_v1', 600000, 32, 'sha512');
  const privateKey = '0x' + derived.toString('hex');
  const wallet = new ethers.Wallet(privateKey);
  return { privateKey, address: wallet.address };
}

export function deriveBackupGuardian(password) {
  const derived = crypto.pbkdf2Sync(password, 'BACKUP_GUARDIAN_SALT_v1', 600000, 32, 'sha512');
  const privateKey = '0x' + derived.toString('hex');
  const wallet = new ethers.Wallet(privateKey);
  return { privateKey, address: wallet.address };
}

// ─── Persistence ───
export async function loadVaultInfo() {
  try { return JSON.parse(await fs.readFile(VAULT_FILE, 'utf8')); } catch { return null; }
}

export async function saveVaultInfo(info) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(VAULT_FILE, JSON.stringify(info, null, 2));
}

export async function getVaultContract(rpcUrl, signer = null) {
  const info = await loadVaultInfo();
  if (!info) throw new Error('No vault');
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  if (signer) {
    return new ethers.Contract(info.address, artifact.abi, signer.connect(provider));
  }
  return new ethers.Contract(info.address, artifact.abi, provider);
}

// ─── Dual Signature Helper ───
// Contract requires ownerSig + guardianSig for every admin action

async function signAsOwner(ownerPrivateKey, actionType, values, nonce, chainId) {
  const wallet = new ethers.Wallet(ownerPrivateKey);
  const txHash = ethers.solidityPackedKeccak256(
    ['string', ...(values.map(() => 'uint256'))],
    [actionType, ...values, nonce]
  );
  return await wallet.signMessage(ethers.getBytes(txHash));
}

async function signAsGuardian(guardianPrivateKey, actionType, values, nonce, chainId) {
  const wallet = new ethers.Wallet(guardianPrivateKey);
  const txHash = ethers.solidityPackedKeccak256(
    ['string', ...(values.map(() => 'uint256'))],
    [actionType, ...values, nonce]
  );
  return await wallet.signMessage(ethers.getBytes(txHash));
}

async function getNonce(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return Number(await vault.nonce());
}

// ─── Deploy ───
export async function deployVault(ownerPrivateKey, guardian1Addr, guardian2Addr, guardian3Addr, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(ownerPrivateKey, provider);
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  
  const factory = new ethers.ContractFactory(artifact.abi, '0x' + artifact.evm.bytecode.object, wallet);
  const contract = await factory.deploy(wallet.address, guardian1Addr, guardian2Addr, guardian3Addr);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  await saveVaultInfo({ 
    address, 
    owner: wallet.address, 
    guardian1: guardian1Addr, 
    guardian2: guardian2Addr, 
    guardian3: guardian3Addr, 
    deployedAt: new Date().toISOString(),
    whitelistedAirdrops: [],
  });
  return { address };
}

// ─── Balance ───
export async function getBalance(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.getBalance();
}

export async function isFrozen(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.frozen();
}

// ─── Whitelist Management (2-sig required) ───
export async function addToWhitelist(ownerPrivateKey, guardianPrivateKey, addressToWhitelist, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  const guardianWallet = new ethers.Wallet(guardianPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'ADD_WHITELIST', 
    [BigInt(addressToWhitelist)], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'ADD_WHITELIST',
    [BigInt(addressToWhitelist)], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.addToWhitelist(addressToWhitelist, ownerSig, guardianSig);
  await tx.wait();
  
  info.whitelistedAirdrops = info.whitelistedAirdrops || [];
  if (!info.whitelistedAirdrops.includes(addressToWhitelist)) {
    info.whitelistedAirdrops.push(addressToWhitelist);
    await saveVaultInfo(info);
  }
  
  return { success: true, txHash: tx.hash };
}

export async function removeFromWhitelist(ownerPrivateKey, guardianPrivateKey, addressToRemove, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'REMOVE_WHITELIST',
    [BigInt(addressToRemove)], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'REMOVE_WHITELIST',
    [BigInt(addressToRemove)], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.removeFromWhitelist(addressToRemove, ownerSig, guardianSig);
  await tx.wait();
  
  info.whitelistedAirdrops = (info.whitelistedAirdrops || []).filter(a => a !== addressToRemove);
  await saveVaultInfo(info);
  
  return { success: true, txHash: tx.hash };
}

export async function toggleWhitelist(ownerPrivateKey, guardianPrivateKey, enabled, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'TOGGLE_WHITELIST',
    [enabled ? 1n : 0n], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'TOGGLE_WHITELIST',
    [enabled ? 1n : 0n], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.toggleWhitelist(enabled, ownerSig, guardianSig);
  await tx.wait();
  
  return { success: true, txHash: tx.hash, whitelistEnabled: enabled };
}

export async function isWhitelisted(address, rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.whitelisted(address);
}

// ─── Spending Limits (2-sig required) ───
export async function setSpendingLimits(ownerPrivateKey, guardianPrivateKey, maxPerTx, maxPerDay, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'SET_LIMITS',
    [maxPerTx, maxPerDay], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'SET_LIMITS',
    [maxPerTx, maxPerDay], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.setLimits(maxPerTx, maxPerDay, ownerSig, guardianSig);
  await tx.wait();
  return { success: true, txHash: tx.hash };
}

export async function getSpendingLimits(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  const [maxPerTx, maxPerDay, spentToday, dayStart] = await Promise.all([
    vault.maxPerTx(),
    vault.maxPerDay(),
    vault.spentToday(),
    vault.dayStart(),
  ]);
  return { 
    maxPerTx: ethers.formatEther(maxPerTx), 
    maxPerDay: ethers.formatEther(maxPerDay), 
    spentToday: ethers.formatEther(spentToday), 
    dayStart: Number(dayStart) 
  };
}

// ─── Emergency Freeze (guardian only) ───
export async function emergencyFreeze(guardianPrivateKey, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(guardianPrivateKey, provider);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, wallet);
  
  const tx = await contract.freeze();
  await tx.wait();
  return { success: true, txHash: tx.hash, frozen: true };
}

// ─── Unfreeze (2-sig required) ───
export async function unfreeze(ownerPrivateKey, guardianPrivateKey, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'UNFREEZE', [], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'UNFREEZE', [], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.unfreeze(ownerSig, guardianSig);
  await tx.wait();
  return { success: true, txHash: tx.hash, frozen: false };
}

// ─── Queue Withdrawal (2-sig required) ───
export async function queueWithdrawal(ownerPrivateKey, guardianPrivateKey, to, amount, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  const info = await loadVaultInfo();
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'QUEUE_WITHDRAWAL',
    [BigInt(info.address), amount, BigInt(to)], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'QUEUE_WITHDRAWAL',
    [BigInt(info.address), amount, BigInt(to)], nonce, chainId);
  
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.queueWithdrawal(amount, to, ownerSig, guardianSig);
  await tx.wait();
  return { success: true, txHash: tx.hash };
}

// ─── Execute Withdrawal (no sig needed after delay) ───
export async function executeWithdrawal(ownerPrivateKey, queueId, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, wallet);
  
  const tx = await contract.executeWithdrawal(queueId);
  await tx.wait();
  return { success: true, txHash: tx.hash };
}

// ─── Cancel Withdrawal (guardian only) ───
export async function cancelWithdrawal(guardianPrivateKey, queueId, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(guardianPrivateKey, provider);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, wallet);
  
  const tx = await contract.cancelWithdrawal(queueId);
  await tx.wait();
  return { success: true, txHash: tx.hash };
}

// ─── Session Keys (2-sig to create) ───
export async function createSession(ownerPrivateKey, guardianPrivateKey, sessionKey, duration, maxAmount, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'CREATE_SESSION',
    [BigInt(sessionKey), BigInt(duration), maxAmount], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'CREATE_SESSION',
    [BigInt(sessionKey), BigInt(duration), maxAmount], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.createSession(sessionKey, duration, maxAmount, ownerSig, guardianSig);
  await tx.wait();
  return { success: true, txHash: tx.hash, sessionKey, duration, maxAmount };
}

export async function revokeSession(ownerPrivateKey, guardianPrivateKey, sessionKey, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const ownerSig = await signAsOwner(ownerPrivateKey, 'REVOKE_SESSION',
    [BigInt(sessionKey)], nonce, chainId);
  const guardianSig = await signAsGuardian(guardianPrivateKey, 'REVOKE_SESSION',
    [BigInt(sessionKey)], nonce, chainId);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const tx = await contract.revokeSession(sessionKey, ownerSig, guardianSig);
  await tx.wait();
  return { success: true, txHash: tx.hash };
}

// ─── Social Recovery (2-of-3 guardians) ───
export async function recoverOwner(guardian1PrivateKey, guardian2PrivateKey, newOwner, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  const nonce = await getNonce(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  const txHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256'],
    ['RECOVER_OWNER', newOwner, nonce]
  );
  
  const g1Wallet = new ethers.Wallet(guardian1PrivateKey);
  const g2Wallet = new ethers.Wallet(guardian2PrivateKey);
  
  const sig1 = await g1Wallet.signMessage(ethers.getBytes(txHash));
  const sig2 = await g2Wallet.signMessage(ethers.getBytes(txHash));
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, provider);
  
  // Need a signer to send tx — use any wallet with gas
  const tx = await contract.recoverOwner(newOwner, sig1, sig2);
  await tx.wait();
  
  info.owner = newOwner;
  await saveVaultInfo(info);
  
  return { success: true, txHash: tx.hash, newOwner };
}

// ─── Vault Summary ───
export async function getVaultSummary(rpcUrl) {
  const info = await loadVaultInfo();
  if (!info) return { exists: false };
  
  const vault = await getVaultContract(rpcUrl);
  const [balance, frozen, maxPerTx, maxPerDay, spentToday, dayStart, whitelistEnabled] = await Promise.all([
    vault.getBalance(),
    vault.frozen(),
    vault.maxPerTx(),
    vault.maxPerDay(),
    vault.spentToday(),
    vault.dayStart(),
    vault.whitelistEnabled(),
  ]);
  
  return {
    exists: true,
    address: info.address,
    owner: info.owner,
    guardian1: info.guardian1,
    guardian2: info.guardian2,
    guardian3: info.guardian3,
    deployedAt: info.deployedAt,
    balance: ethers.formatEther(balance),
    balanceWei: balance.toString(),
    frozen,
    whitelistEnabled,
    maxPerTx: ethers.formatEther(maxPerTx),
    maxPerDay: ethers.formatEther(maxPerDay),
    spentToday: ethers.formatEther(spentToday),
    dayStart: new Date(Number(dayStart) * 1000).toISOString(),
    whitelistedAirdrops: info.whitelistedAirdrops || [],
  };
}
