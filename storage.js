import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = './data';
const WALLET_FILE = path.join(DATA_DIR, 'wallet.json');
const TX_LOG = path.join(DATA_DIR, 'tx-log.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

async function ensureDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
}

export async function loadWallet() {
  await ensureDir();
  try {
    const data = await fs.readFile(WALLET_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveWallet(walletData) {
  await ensureDir();
  await fs.writeFile(WALLET_FILE, JSON.stringify(walletData, null, 2));
}

export async function deleteWallet() {
  await ensureDir();
  try { await fs.unlink(WALLET_FILE); } catch {}
}

export async function logTransaction(txRecord) {
  await ensureDir();
  let logs = [];
  try {
    const data = await fs.readFile(TX_LOG, 'utf8');
    logs = JSON.parse(data);
  } catch {}
  logs.push({ ...txRecord, timestamp: new Date().toISOString() });
  await fs.writeFile(TX_LOG, JSON.stringify(logs, null, 2));
}

export async function loadTxLogs() {
  try {
    const data = await fs.readFile(TX_LOG, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveSettings(settings) {
  await ensureDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { rpcUrl: 'https://eth.llamarpc.com', chainId: 1 };
  }
}
