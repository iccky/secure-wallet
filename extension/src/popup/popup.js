/**
 * Secure Wallet — Popup Controller
 * Handles all UI state, user interactions, and background communication
 */

// ─── State ───
let currentView = 'welcome';
let walletState = { exists: false, unlocked: false, address: null };
let currentNetwork = 'ethereum';

// ─── DOM Ready ───
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await checkWalletStatus();
  bindEvents();
  renderView();
}

// ─── Background Communication ───
function send(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, data }, resolve);
  });
}

// ─── Wallet Status ───
async function checkWalletStatus() {
  const status = await send('GET_WALLET_STATUS');
  walletState = status;
  
  if (status.unlocked) {
    currentView = 'dashboard';
    await loadDashboard();
  } else if (status.exists) {
    currentView = 'unlock';
  } else {
    currentView = 'welcome';
  }
}

// ─── View Navigation ───
function showView(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  document.getElementById(`view-${viewId}`).classList.remove('hidden');
  currentView = viewId;
}

function renderView() {
  showView(currentView);
}

// ─── Event Bindings ───
function bindEvents() {
  // Welcome
  $('#btn-create').onclick = () => showView('create-password');
  $('#btn-recover').onclick = () => showRecover();
  
  // Create Password
  $('#create-password').oninput = checkPasswordStrength;
  $('#create-password-confirm').oninput = checkPasswordMatch;
  $('#agree-terms').onchange = checkCanCreate;
  $('#btn-create-submit').onclick = createWallet;
  $('#btn-create-back').onclick = () => showView('welcome');
  
  // Mnemonic
  $('#confirm-saved').onchange = (e) => {
    $('#btn-mnemonic-continue').disabled = !e.target.checked;
  };
  $('#btn-mnemonic-continue').onclick = () => {
    showView('dashboard');
    loadDashboard();
  };
  $('#btn-copy-mnemonic').onclick = copyMnemonic;
  
  // Unlock
  $('#btn-unlock').onclick = unlockWallet;
  $('#unlock-password').onkeydown = (e) => e.key === 'Enter' && unlockWallet();
  $('#btn-unlock-reset').onclick = resetWallet;
  
  // Dashboard
  $('#btn-send').onclick = () => showView('send');
  $('#btn-receive').onclick = showReceive;
  $('#btn-vault').onclick = showVault;
  
  // Send
  $('#send-to').oninput = validateSendForm;
  $('#send-amount').oninput = validateSendForm;
  $('#btn-max').onclick = setMaxAmount;
  $('#btn-send-submit').onclick = sendTransaction;
  $('#btn-send-back').onclick = () => showView('dashboard');
  
  // Receive
  $('#btn-copy-address').onclick = copyAddress;
  $('#btn-receive-back').onclick = () => showView('dashboard');
  
  // Vault
  $('#btn-deploy-vault').onclick = deployVault;
  $('#btn-freeze').onclick = freezeVault;
  $('#btn-vault-back').onclick = () => showView('dashboard');
  
  // Footer tabs
  $('#tab-home').onclick = () => { showView('dashboard'); setTab('tab-home'); };
  $('#tab-security').onclick = () => showView('vault');
  
  // Network
  $('#network-select').onchange = switchNetwork;
}

// ─── Helpers ───
function $(sel) { return document.querySelector(sel); }
function showLoading(text = 'Processing...') {
  $('#loading-text').textContent = text;
  $('#loading-overlay').classList.remove('hidden');
}
function hideLoading() { $('#loading-overlay').classList.add('hidden'); }

function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Password Strength ───
function checkPasswordStrength() {
  const pw = $('#create-password').value;
  const fill = $('#strength-fill');
  const text = $('#strength-text');
  
  let strength = 0;
  if (pw.length >= 12) strength++;
  if (pw.length >= 16) strength++;
  if (/[A-Z]/.test(pw)) strength++;
  if (/[0-9]/.test(pw)) strength++;
  if (/[^A-Za-z0-9]/.test(pw)) strength++;
  
  const width = Math.min((strength / 5) * 100, 100);
  fill.style.width = `${width}%`;
  fill.className = `strength-fill ${['weak', 'fair', 'good', 'strong', 'very-strong'][Math.min(strength - 1, 4)] || 'weak'}`;
  
  text.textContent = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'][strength];
  checkCanCreate();
}

function checkPasswordMatch() {
  const pw = $('#create-password').value;
  const confirm = $('#create-password-confirm').value;
  $('#create-password-confirm').style.borderColor = confirm && pw !== confirm ? '#ef4444' : '';
  checkCanCreate();
}

function checkCanCreate() {
  const pw = $('#create-password').value;
  const confirm = $('#create-password-confirm').value;
  const agreed = $('#agree-terms').checked;
  const valid = pw.length >= 12 && pw === confirm && agreed;
  $('#btn-create-submit').disabled = !valid;
}

// ─── Create Wallet ───
async function createWallet() {
  const password = $('#create-password').value;
  showLoading('Creating your secure wallet...');
  
  try {
    const result = await send('CREATE_WALLET', { password });
    if (result.success) {
      // Fetch full wallet data for mnemonic
      const walletData = await chrome.storage.local.get('wallet');
      const wallet = JSON.parse(walletData.wallet);
      showMnemonic(wallet.mnemonic);
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

function showMnemonic(mnemonic) {
  const words = mnemonic.split(' ');
  const grid = $('#mnemonic-grid');
  grid.innerHTML = words.map((w, i) => `
    <div class="mnemonic-word">
      <span class="word-index">${i + 1}</span>
      <span class="word-text">${w}</span>
    </div>
  `).join('');
  showView('mnemonic');
}

function copyMnemonic() {
  const words = [...document.querySelectorAll('.word-text')].map(el => el.textContent).join(' ');
  navigator.clipboard.writeText(words);
  showToast('Recovery phrase copied! Store it safely.', 'warning');
}

// ─── Unlock ───
async function unlockWallet() {
  const password = $('#unlock-password').value;
  showLoading('Unlocking...');
  
  try {
    const result = await send('UNLOCK_WALLET', { password });
    if (result.success) {
      showView('dashboard');
      await loadDashboard();
    } else {
      showToast('Wrong password', 'error');
      $('#unlock-password').value = '';
    }
  } finally {
    hideLoading();
  }
}

function resetWallet() {
  if (confirm('⚠️ WARNING: This will permanently delete your wallet. Make sure you have your recovery phrase!')) {
    chrome.storage.local.clear();
    showToast('Wallet reset. Reloading...', 'info');
    setTimeout(() => location.reload(), 1500);
  }
}

// ─── Dashboard ───
async function loadDashboard() {
  const status = await send('GET_WALLET_STATUS');
  if (!status.unlocked) return;
  
  $('#account-address').textContent = shortenAddress(status.address);
  $('#account-avatar').textContent = generateAvatar(status.address);
  
  // Update security layers
  const sec = await send('GET_SECURITY_STATUS');
  $('#layer-vault').textContent = sec.vaultDeployed ? '🟢' : '⚪';
  $('#layer-timelock').textContent = sec.vaultDeployed ? '🟢' : '⚪';
  $('#layer-cap').textContent = sec.spendingLimit ? '🟢' : '⚪';
  $('#layer-whitelist').textContent = sec.whitelistCount > 0 ? '🟢' : '⚪';
  
  // Update badge
  const activeLayers = [sec.vaultDeployed, sec.vaultDeployed, sec.spendingLimit, sec.whitelistCount > 0].filter(Boolean).length;
  const badge = $('#status-badge');
  badge.textContent = ['Basic', 'Protected', 'Secure', 'Fortress'][activeLayers] || 'Basic';
  badge.className = `status-badge ${['basic', 'protected', 'secure', 'fortress'][activeLayers] || 'basic'}`;
}

// ─── Send ───
async function validateSendForm() {
  const to = $('#send-to').value;
  const amount = parseFloat($('#send-amount').value);
  const validTo = /^0x[a-fA-F0-9]{40}$/.test(to);
  const validAmount = amount > 0;
  
  $('#send-to-error').textContent = to && !validTo ? 'Invalid address' : '';
  $('#btn-send-submit').disabled = !(validTo && validAmount);
  
  if (validTo && validAmount) {
    // Estimate gas
    const gasEst = await estimateGas(to, amount);
    $('#summary-amount').textContent = `${amount} ETH`;
    $('#summary-fee').textContent = `${gasEst.fee} ETH`;
    $('#summary-total').textContent = `${(amount + gasEst.fee).toFixed(6)} ETH`;
  }
}

async function estimateGas(to, value) {
  // Mock estimation - in real impl, call provider
  return { fee: 0.0005 };
}

function setMaxAmount() {
  // Get actual balance
  $('#send-amount').value = '1.0'; // placeholder
  validateSendForm();
}

async function sendTransaction() {
  const to = $('#send-to').value;
  const amount = $('#send-amount').value;
  showLoading('Signing transaction...');
  
  try {
    const result = await send('SIGN_TRANSACTION', {
      tx: { to, value: amount },
      chainId: currentNetwork
    });
    if (result.success) {
      showToast('Transaction sent!', 'success');
      showView('dashboard');
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ─── Receive ───
function showReceive() {
  const status = walletState;
  if (!status.address) return;
  
  $('#receive-address').textContent = status.address;
  // Generate QR (mock)
  $('#qr-code').innerHTML = `<div class="qr-placeholder">QR</div>`;
  showView('receive');
}

function copyAddress() {
  navigator.clipboard.writeText($('#receive-address').textContent);
  showToast('Address copied!', 'success');
}

// ─── Vault ───
async function showVault() {
  const sec = await send('GET_SECURITY_STATUS');
  
  if (sec.vaultDeployed) {
    $('#vault-not-deployed').classList.add('hidden');
    $('#vault-deployed').classList.remove('hidden');
    // Load vault address
    $('#vault-address').textContent = '0x...'; // from storage
  } else {
    $('#vault-not-deployed').classList.remove('hidden');
    $('#vault-deployed').classList.add('hidden');
  }
  
  showView('vault');
}

async function deployVault() {
  showLoading('Deploying vault smart contract...');
  
  try {
    const result = await send('DEPLOY_VAULT', {
      rpcUrl: 'https://eth.llamarpc.com',
      guardians: [] // would collect from UI
    });
    if (result.success) {
      showToast('Vault deployed!', 'success');
      showVault();
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

async function freezeVault() {
  if (!confirm('🚨 Emergency freeze will halt ALL withdrawals immediately. Continue?')) return;
  
  showLoading('Activating emergency freeze...');
  try {
    await send('FREEZE_VAULT', { rpcUrl: 'https://eth.llamarpc.com' });
    showToast('Vault FROZEN. All withdrawals halted.', 'warning');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ─── Network ───
async function switchNetwork(e) {
  currentNetwork = e.target.value;
  await send('SWITCH_NETWORK', { network: currentNetwork });
  showToast(`Switched to ${currentNetwork}`, 'info');
  if (currentView === 'dashboard') loadDashboard();
}

// ─── Utilities ───
function shortenAddress(addr) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';
}

function generateAvatar(address) {
  // Simple blocky avatar from address
  const colors = ['#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#ef4444', '#f59e0b'];
  const idx = parseInt(address.slice(2, 4), 16) % colors.length;
  return address ? address.slice(2, 4).toUpperCase() : '?';
}

function setTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $(`#${tabId}`).classList.add('active');
}
