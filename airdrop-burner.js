import { ethers } from 'ethers';
import fs from 'fs/promises';
import path from 'path';
import { loadVaultInfo } from './vault-core.js';

const DATA_DIR = './data';
const HUNTERS_FILE = path.join(DATA_DIR, 'airdrop-hunters.json');

// ═══════════════════════════════════════════════════════════════════
// AIRDROP BURNER MANAGER
// ═══════════════════════════════════════════════════════════════════
// EOA wallets for airdrop hunting — auto-sweep to vault
// Pattern: Generate → Fund → Use → Sweep → Burn
// ═══════════════════════════════════════════════════════════════════

export async function loadHunters() {
  try { return JSON.parse(await fs.readFile(HUNTERS_FILE, 'utf8')); } 
  catch { return { hunters: [], activeCampaigns: [] }; }
}

export async function saveHunters(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HUNTERS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Generate new burner EOA from seed phrase
 * Path: m/44'/60'/0'/0/{index}
 */
export function generateBurner(seedPhrase, index) {
  const hdNode = ethers.HDNodeWallet.fromPhrase(seedPhrase);
  const child = hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
  return {
    index,
    address: child.address,
    privateKey: child.privateKey,
    path: `m/44'/60'/0'/0/${index}`,
  };
}

/**
 * Create new airdrop campaign with dedicated burner wallet
 */
export async function createCampaign(seedPhrase, campaignName, chain = 'base') {
  const data = await loadHunters();
  const index = data.hunters.length;
  const burner = generateBurner(seedPhrase, index);
  
  const campaign = {
    id: `campaign_${Date.now()}`,
    name: campaignName,
    chain,
    burnerIndex: index,
    burnerAddress: burner.address,
    createdAt: new Date().toISOString(),
    status: 'created', // created → funded → active → sweeping → burned
    totalClaimed: '0',
    totalSwept: '0',
    transactions: [],
  };
  
  data.hunters.push({
    index,
    address: burner.address,
    createdAt: campaign.createdAt,
    campaigns: [campaign.id],
  });
  data.activeCampaigns.push(campaign.id);
  
  await saveHunters(data);
  return { campaign, burner };
}

/**
 * Get burner wallet instance for signing transactions
 */
export function getBurnerWallet(seedPhrase, index, rpcUrl) {
  const hdNode = ethers.HDNodeWallet.fromPhrase(seedPhrase);
  const child = hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(child.privateKey, provider);
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SWEEP ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Sweep ALL assets from burner to vault
 * Returns: { ethSwept, tokensSwept[], errors[] }
 */
export async function sweepBurnerToVault(burnerPrivateKey, vaultAddress, rpcUrl, tokenList = []) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(burnerPrivateKey, provider);
  const results = { ethSwept: null, tokensSwept: [], errors: [] };
  
  // 1. Sweep ETH
  try {
    const balance = await provider.getBalance(wallet.address);
    if (balance > 0n) {
      const gasPrice = (await provider.getFeeData()).gasPrice;
      const gasLimit = 21000n;
      const gasCost = gasPrice * gasLimit;
      const sendAmount = balance - gasCost;
      
      if (sendAmount > 0n) {
        const tx = await wallet.sendTransaction({
          to: vaultAddress,
          value: sendAmount,
          gasLimit: 21000,
        });
        const receipt = await tx.wait();
        results.ethSwept = {
          txHash: receipt.hash,
          amount: ethers.formatEther(sendAmount),
        };
      }
    }
  } catch (err) {
    results.errors.push({ type: 'ETH', error: err.message });
  }
  
  // 2. Sweep ERC20 tokens
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ];
  
  for (const token of tokenList) {
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
      const balance = await contract.balanceOf(wallet.address);
      
      if (balance > 0n) {
        const tx = await contract.transfer(vaultAddress, balance);
        const receipt = await tx.wait();
        results.tokensSwept.push({
          symbol: token.symbol,
          address: token.address,
          amount: balance.toString(),
          txHash: receipt.hash,
        });
      }
    } catch (err) {
      results.errors.push({ type: 'ERC20', symbol: token.symbol, error: err.message });
    }
  }
  
  return results;
}

/**
 * Auto-sweep scheduler — Run every X minutes via cron
 * Sweeps all active campaign burners
 */
export async function autoSweepAll(seedPhrase, vaultAddress, rpcUrl, minEthThreshold = '0.01') {
  const data = await loadHunters();
  const threshold = ethers.parseEther(minEthThreshold);
  const sweepResults = [];
  
  for (const hunter of data.hunters) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = getBurnerWallet(seedPhrase, hunter.index, rpcUrl);
    const balance = await provider.getBalance(wallet.address);
    
    if (balance >= threshold) {
      const result = await sweepBurnerToVault(wallet.privateKey, vaultAddress, rpcUrl);
      sweepResults.push({
        burnerIndex: hunter.index,
        address: hunter.address,
        ...result,
      });
    }
  }
  
  return sweepResults;
}

// ═══════════════════════════════════════════════════════════════════
// SESSION KEY REFILL (Quick ETH transfer from vault to burner)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create session key for quick vault → burner refill
 * This is the ONLY fast path out of vault
 * Owner + Guardian sign once → session key active for N days
 */
export async function createRefillSession(
  ownerPrivateKey,
  guardianPrivateKey, 
  sessionAddress,
  maxAmount,
  durationDays = 7,
  rpcUrl
) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
  const guardianWallet = new ethers.Wallet(guardianPrivateKey, provider);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, ownerWallet);
  
  const chainId = (await provider.getNetwork()).chainId;
  const duration = durationDays * 24 * 3600;
  const nonce = Number(await contract.nonce());
  
  // Owner sign
  const txHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256', 'uint256'],
    ['CREATE_SESSION', sessionAddress, duration, maxAmount, nonce]
  );
  const ethHash = ethers.hashMessage(ethers.getBytes(txHash));
  const ownerSig = await ownerWallet.signMessage(ethers.getBytes(txHash));
  
  // Guardian sign
  const guardianSig = await guardianWallet.signMessage(ethers.getBytes(txHash));
  
  // Send transaction (need to connect with a signer that can pay gas)
  const tx = await contract.createSession(sessionAddress, duration, maxAmount, ownerSig, guardianSig);
  await tx.wait();
  
  return {
    sessionAddress,
    maxAmount: ethers.formatEther(maxAmount),
    durationDays,
    expiresAt: new Date(Date.now() + duration * 1000).toISOString(),
    txHash: tx.hash,
  };
}

/**
 * Use session key to quickly refill burner from vault
 * No 24h delay, no guardian approval needed per tx
 */
export async function refillBurnerWithSession(
  sessionPrivateKey,
  burnerAddress,
  amount,
  rpcUrl
) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const sessionWallet = new ethers.Wallet(sessionPrivateKey, provider);
  
  const info = await loadVaultInfo();
  const artifact = JSON.parse(await fs.readFile('./contracts/AntiDrainVault.json', 'utf8'));
  const contract = new ethers.Contract(info.address, artifact.abi, sessionWallet);
  
  const chainId = (await provider.getNetwork()).chainId;
  const nonce = Number(await contract.nonce());
  
  // Session sign
  const txHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256', 'address'],
    ['SESSION_SPEND', info.address, burnerAddress, amount, nonce]
  );
  const sessionSig = await sessionWallet.signMessage(ethers.getBytes(txHash));
  
  const tx = await contract.spendWithSession(burnerAddress, amount, sessionSig);
  await tx.wait();
  
  return { txHash: tx.hash, amount: ethers.formatEther(amount), to: burnerAddress };
}

// ═══════════════════════════════════════════════════════════════════
// SAFETY: Race Protection Against Hacker
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if burner might be compromised
 * Compares expected vs actual balance changes
 */
export async function detectAnomaly(seedPhrase, index, rpcUrl, expectedBalance) {
  const wallet = getBurnerWallet(seedPhrase, index, rpcUrl);
  const actualBalance = await wallet.provider.getBalance(wallet.address);
  
  // If balance dropped unexpectedly (more than gas costs), flag it
  const diff = BigInt(expectedBalance) - actualBalance;
  const threshold = ethers.parseEther('0.001'); // Allow for gas
  
  if (diff > threshold) {
    return {
      compromised: true,
      reason: `Unexpected balance drop: expected ${expectedBalance}, got ${actualBalance.toString()}`,
      burnerAddress: wallet.address,
    };
  }
  
  return { compromised: false };
}

/**
 * Emergency sweep all burners immediately
 * Guardian triggers this when compromise detected
 */
export async function emergencySweepAllBurners(seedPhrase, vaultAddress, rpcUrl) {
  const data = await loadHunters();
  const results = [];
  
  for (const hunter of data.hunters) {
    try {
      const wallet = getBurnerWallet(seedPhrase, hunter.index, rpcUrl);
      const result = await sweepBurnerToVault(wallet.privateKey, vaultAddress, rpcUrl);
      results.push({ burnerIndex: hunter.index, success: true, ...result });
    } catch (err) {
      results.push({ burnerIndex: hunter.index, success: false, error: err.message });
    }
  }
  
  return results;
}
