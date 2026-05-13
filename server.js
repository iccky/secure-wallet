import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import walletManager from './wallet-manager.js';
import * as vaultCore from './vault-core.js';
import { generateBurner, createCampaign, getBurnerWallet, sweepBurnerToVault, loadHunters } from './airdrop-burner.js';
import { AirdropClaimer } from './airdrop-hunter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function getSettings() {
  try {
    const s = JSON.parse(await (await import('fs/promises')).readFile('./data/settings.json', 'utf8'));
    return s;
  } catch {
    return { rpcUrl: 'https://eth.llamarpc.com', chainId: 1 };
  }
}

// ═══════════════════════════════════════════
// LEGACY WALLET ROUTES
// ═══════════════════════════════════════════
app.get('/api/wallet', asyncHandler(async (req, res) => {
  const exists = await walletManager.walletExists();
  if (!exists) return res.json({ exists: false });
  const info = await walletManager.getWalletInfo();
  res.json({ exists: true, ...info });
}));

app.post('/api/wallet/create', asyncHandler(async (req, res) => {
  const { secondaryPassword } = req.body;
  if (!secondaryPassword || secondaryPassword.length < 8) {
    return res.status(400).json({ error: 'Secondary password must be at least 8 characters' });
  }
  const result = await walletManager.createWallet(secondaryPassword);
  res.json(result);
}));

app.post('/api/wallet/recover', asyncHandler(async (req, res) => {
  const { mnemonic, secondaryPassword } = req.body;
  if (!mnemonic || !secondaryPassword) {
    return res.status(400).json({ error: 'Mnemonic and secondary password required' });
  }
  const result = await walletManager.recoverWallet(mnemonic, secondaryPassword);
  res.json(result);
}));

app.get('/api/balance', asyncHandler(async (req, res) => {
  const info = await walletManager.getWalletInfo();
  if (!info) return res.status(404).json({ error: 'No wallet' });
  res.json({ address: info.address, balance: info.balance, balanceWei: info.balanceWei });
}));

app.post('/api/send', asyncHandler(async (req, res) => {
  const { to, amount, secondaryPassword, gasLimit } = req.body;
  if (!to || !amount || !secondaryPassword) {
    return res.status(400).json({ error: 'to, amount, and secondaryPassword required' });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  }
  const result = await walletManager.sendTransaction(secondaryPassword, { to, amount, gasLimit });
  res.json(result);
}));

app.get('/api/settings', asyncHandler(async (req, res) => {
  const s = await walletManager.getSettings();
  res.json(s);
}));

app.post('/api/settings', asyncHandler(async (req, res) => {
  const { rpcUrl, chainId } = req.body;
  await walletManager.setSettings(rpcUrl, chainId);
  res.json({ updated: true });
}));

// ═══════════════════════════════════════════
// ANTIDRAIN VAULT ROUTES
// ═══════════════════════════════════════════

app.get('/api/vault', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const summary = await vaultCore.getVaultSummary(settings.rpcUrl);
  res.json(summary);
}));

app.post('/api/vault/deploy', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, secondaryPassword } = req.body;
  if (!ownerPrivateKey || !secondaryPassword) {
    return res.status(400).json({ error: 'ownerPrivateKey and secondaryPassword required' });
  }
  const settings = await getSettings();
  const g1 = vaultCore.deriveGuardianKey(secondaryPassword);
  const g2 = vaultCore.deriveBackupGuardian(secondaryPassword);
  const g3 = ethers.Wallet.createRandom().address; // Emergency recovery guardian
  
  const result = await vaultCore.deployVault(ownerPrivateKey, g1.address, g2.address, g3, settings.rpcUrl);
  res.json({ ...result, guardians: { g1: g1.address, g2: g2.address, g3 } });
}));

app.post('/api/vault/whitelist', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, guardianPrivateKey, address } = req.body;
  if (!ownerPrivateKey || !guardianPrivateKey || !address) return res.status(400).json({ error: 'Missing params' });
  const settings = await getSettings();
  const result = await vaultCore.addToWhitelist(ownerPrivateKey, guardianPrivateKey, address, settings.rpcUrl);
  res.json(result);
}));

app.delete('/api/vault/whitelist/:address', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, guardianPrivateKey } = req.body;
  if (!ownerPrivateKey || !guardianPrivateKey) return res.status(400).json({ error: 'Missing params' });
  const settings = await getSettings();
  const result = await vaultCore.removeFromWhitelist(ownerPrivateKey, guardianPrivateKey, req.params.address, settings.rpcUrl);
  res.json(result);
}));

app.post('/api/vault/whitelist-toggle', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, guardianPrivateKey, enabled } = req.body;
  const settings = await getSettings();
  const result = await vaultCore.toggleWhitelist(ownerPrivateKey, guardianPrivateKey, enabled, settings.rpcUrl);
  res.json(result);
}));

app.get('/api/vault/limits', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const limits = await vaultCore.getSpendingLimits(settings.rpcUrl);
  res.json(limits);
}));

app.post('/api/vault/limits', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, guardianPrivateKey, maxPerTx, maxPerDay } = req.body;
  const settings = await getSettings();
  const maxTx = ethers.parseEther(maxPerTx.toString());
  const maxDay = ethers.parseEther(maxPerDay.toString());
  const result = await vaultCore.setSpendingLimits(ownerPrivateKey, guardianPrivateKey, maxTx, maxDay, settings.rpcUrl);
  res.json(result);
}));

app.post('/api/vault/freeze', asyncHandler(async (req, res) => {
  const { guardianPrivateKey } = req.body;
  const settings = await getSettings();
  const result = await vaultCore.emergencyFreeze(guardianPrivateKey, settings.rpcUrl);
  res.json(result);
}));

app.post('/api/vault/unfreeze', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, guardianPrivateKey } = req.body;
  const settings = await getSettings();
  const result = await vaultCore.unfreeze(ownerPrivateKey, guardianPrivateKey, settings.rpcUrl);
  res.json(result);
}));

app.post('/api/vault/queue-withdrawal', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, guardianPrivateKey, to, amount } = req.body;
  const settings = await getSettings();
  const amt = ethers.parseEther(amount.toString());
  const result = await vaultCore.queueWithdrawal(ownerPrivateKey, guardianPrivateKey, to, amt, settings.rpcUrl);
  res.json(result);
}));

app.post('/api/vault/execute-withdrawal', asyncHandler(async (req, res) => {
  const { ownerPrivateKey, queueId } = req.body;
  const settings = await getSettings();
  const result = await vaultCore.executeWithdrawal(ownerPrivateKey, queueId, settings.rpcUrl);
  res.json(result);
}));

app.post('/api/vault/cancel-withdrawal', asyncHandler(async (req, res) => {
  const { guardianPrivateKey, queueId } = req.body;
  const settings = await getSettings();
  const result = await vaultCore.cancelWithdrawal(guardianPrivateKey, queueId, settings.rpcUrl);
  res.json(result);
}));

// ═══════════════════════════════════════════
// AIRDROP BURNER ROUTES
// ═══════════════════════════════════════════

// Generate new burner campaign
app.post('/api/airdrop/campaign', asyncHandler(async (req, res) => {
  const { seedPhrase, name, chain } = req.body;
  if (!seedPhrase || !name) return res.status(400).json({ error: 'seedPhrase and name required' });
  
  const result = await createCampaign(seedPhrase, name, chain || 'base');
  // Don't return private key in production!
  const safe = {
    campaign: result.campaign,
    burnerAddress: result.burner.address,
    path: result.burner.path,
  };
  res.json(safe);
}));

// Get burner private key (for claiming)
app.post('/api/airdrop/burner-key', asyncHandler(async (req, res) => {
  const { seedPhrase, index } = req.body;
  if (!seedPhrase || index === undefined) return res.status(400).json({ error: 'Missing params' });
  
  const burner = generateBurner(seedPhrase, index);
  res.json({ index, address: burner.address, privateKey: burner.privateKey });
}));

// Sweep burner to vault
app.post('/api/airdrop/sweep', asyncHandler(async (req, res) => {
  const { privateKey, vaultAddress, rpcUrl, tokens } = req.body;
  if (!privateKey || !vaultAddress) return res.status(400).json({ error: 'Missing params' });
  
  const settings = await getSettings();
  const result = await sweepBurnerToVault(privateKey, vaultAddress, rpcUrl || settings.rpcUrl, tokens || []);
  res.json(result);
}));

// List all hunters/campaigns
app.get('/api/airdrop/hunters', asyncHandler(async (req, res) => {
  const data = await loadHunters();
  res.json(data);
}));

// Claim airdrop (generic contract interaction)
app.post('/api/airdrop/claim', asyncHandler(async (req, res) => {
  const { privateKey, contractAddress, abiType, args, rpcUrl } = req.body;
  if (!privateKey || !contractAddress) return res.status(400).json({ error: 'Missing params' });
  
  const settings = await getSettings();
  const provider = new ethers.JsonRpcProvider(rpcUrl || settings.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  const claimer = new AirdropClaimer(provider);
  
  if (abiType === 'merkle') {
    const result = await claimer.claimMerkle(wallet, contractAddress, args.index, args.amount, args.merkleProof);
    res.json(result);
  } else if (abiType === 'generic') {
    const result = await claimer.claimGeneric(wallet, contractAddress);
    res.json(result);
  } else {
    res.status(400).json({ error: 'Unknown abiType' });
  }
}));

// ═══════════════════════════════════════════
// ERROR HANDLER
// ═══════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('API Error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔐 Secure Wallet + AntiDrainVault + Airdrop Burner running on http://localhost:${PORT}`);
  console.log(`📱 Open UI: http://localhost:${PORT}`);
  console.log(`🎯 Airdrop routes: /api/airdrop/*`);
});
