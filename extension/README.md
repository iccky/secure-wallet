# 🔐 Secure Wallet — Chrome Extension

> **The only EVM wallet where seed phrase leaks DON'T mean total loss.**

A browser extension wallet with 8-layer on-chain security architecture. Even if your private key is compromised, hackers cannot drain your funds.

---

## 🚀 Features

### 8-Layer Security
| Layer | Protection | Description |
|-------|-----------|-------------|
| 1 | **Multi-Sig Vault** | Every withdrawal needs Owner + Guardian signature |
| 2 | **24h Time-Lock** | All withdrawals queued for 24 hours |
| 3 | **Spending Limits** | Max configurable per-transaction cap |
| 4 | **Address Whitelist** | Only approved recipients allowed |
| 5 | **Emergency Freeze** | Instant halt of all withdrawals |
| 6 | **Social Recovery** | Guardians can recover compromised accounts |
| 7 | **Session Keys** | Time-limited keys for small spends |
| 8 | **Passkey Guardian** | Guardian derived from secondary password |

### Multi-Chain Support
- Ethereum, Base, Optimism, Arbitrum, Polygon, BNB Chain

### dApp Compatibility
- Full EIP-1193 provider (`window.ethereum`)
- Compatible with MetaMask-connected dApps
- Transaction signing with user confirmation

---

## 📦 Installation

### From Source (Developer)

```bash
# Clone
git clone https://github.com/iccky/secure-wallet.git
cd secure-wallet-extension

# Load in Chrome
1. Open chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this folder
```

### From Chrome Web Store (Coming Soon)

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Test in Chrome
npm run dev
```

---

## 📁 Project Structure

```
secure-wallet-extension/
├── manifest.json              # Extension manifest v3
├── src/
│   ├── background/
│   │   └── background.js      # Service worker (vault ops, security)
│   ├── popup/
│   │   ├── popup.html         # Wallet UI
│   │   ├── popup.css          # Dark theme styles
│   │   └── popup.js           # UI controller
│   ├── content/
│   │   ├── inject.js          # Injects provider into pages
│   │   └── provider.js        # EIP-1193 provider
│   └── utils/
│       ├── crypto.js          # Web Crypto API engine
│       ├── storage.js         # Encrypted chrome.storage
│       ├── wallet.js          # EOA wallet management
│       ├── vault.js           # Smart contract vault
│       └── network.js         # Chain configurations
├── icons/                     # Extension icons
└── README.md
```

---

## 🔐 Security Model

```
User Seed Phrase → EOA Wallet
       ↓
Secondary Password → Encrypted Private Key (AES-256-GCM)
       ↓
Guardian Key (derived from password) → Vault Multi-Sig
       ↓
Smart Contract enforces: Time-lock + Spending Cap + Whitelist
```

Even if attacker has:
- ✅ Seed phrase → Needs secondary password + guardian key
- ✅ Secondary password → Still needs guardian signature + time delay
- ✅ Guardian key → Still needs owner signature + time delay

---

## 📄 License

MIT — See [LICENSE](../LICENSE)
