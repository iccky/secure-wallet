# 🔐 Secure Wallet — Anti-Drain Protection

> **Even if your seed phrase leaks, hackers cannot drain your funds.**

An EVM-compatible smart wallet with **8-layer security architecture** designed to protect your crypto assets even when your private key or seed phrase is compromised.

---

## 🚀 Quick Start

```bash
# Clone & install
git clone https://github.com/iccky/secure-wallet.git
cd secure-wallet
npm install

# Start the web UI + REST API
npm start
# → Open http://localhost:3000
```

---

## 🛡️ 8-Layer Security Architecture

| # | Layer | Protection | Hacker Impact |
|---|-------|-----------|---------------|
| 1 | **2-of-2 Multi-Sig** | Every withdrawal needs Owner + Guardian signature | Stuck — cannot sign alone |
| 2 | **24h Time Delay** | All withdrawals queued for 24 hours | Guardian sees alert → cancels |
| 3 | **Spending Limits** | Max 1 ETH/tx, 5 ETH/day | Cannot drain quickly |
| 4 | **Address Whitelist** | Only approved recipients | Transfer to unknown = REVERT |
| 5 | **Emergency Freeze** | Any guardian freezes ALL withdrawals instantly | Everything stops |
| 6 | **Social Recovery** | 2-of-3 guardians replace compromised owner | You recover, hacker loses |
| 7 | **Session Keys** | Time-limited keys for small spends | Even if leaked, limited damage |
| 8 | **Passkey Guardian** | Guardian key derived from secondary password | Seed ≠ Guardian key |

---

## 📦 What's Included

### Core Wallet (EOA)
- AES-256-GCM encrypted private key storage
- PBKDF2-SHA512 key derivation (600k iterations)
- bcrypt-hashed secondary password
- Send ETH with secondary password verification
- Multi-chain RPC support (Ethereum, Base, Optimism, Arbitrum, and more)

### AntiDrain Vault (Smart Contract)
- Deploy on any EVM chain
- Dual-signature admin actions
- Queued withdrawal system
- Whitelist management
- Spending limit controls
- Emergency freeze/unfreeze
- Social recovery (2-of-3 guardians)
- Session key lifecycle management

### Airdrop Hunter System
- Generate unlimited burner EOAs from one seed phrase (BIP44)
- Campaign tracking per airdrop
- Merkle tree claim support
- Generic claim contract interaction
- EIP-712 signature support
- **Auto-sweep** — transfer all claimed assets back to vault
- Batch sweep (ETH + ERC20 tokens)
- Anomaly detection

### Web UI & REST API
- Dark-themed responsive dashboard
- Create / recover wallet
- Send transactions
- Vault deployment & management
- Airdrop campaign manager
- Transaction history
- Settings (RPC, chain ID)

---

## 🔑 Key Derivation

```
Seed Phrase (12 words)
    │
    ├──► EOA Wallet (Owner Key) → Signs on-chain transactions
    │
    └──► HD Path m/44'/60'/0'/0/N → Burner #1, #2, #3... (Airdrop hunting)

Secondary Password (user input)
    │
    ├──► PBKDF2-SHA512 + salt 'SECURE_WALLET_GUARDIAN_v1'
    │       └──► Guardian Private Key → Guardian Address
    │
    └──► PBKDF2-SHA512 + salt 'BACKUP_GUARDIAN_SALT_v1'
            └──► Backup Guardian Key
```

**Critical**: Seed phrase ≠ Guardian key. A hacker with your seed still cannot access the vault.

---

## 🌐 Supported Chains

| Chain | RPC | Use Case |
|-------|-----|----------|
| **Ethereum** | `eth.llamarpc.com` | Mainnet, high-value |
| **Base** | `base.llamarpc.com` | Coinbase L2, cheap quests |
| **Optimism** | `optimism.llamarpc.com` | Superchain, airdrops |
| **Arbitrum** | `arbitrum.llamarpc.com` | Biggest L2 |
| **Scroll** | `rpc.scroll.io` | zkEVM, early stage |
| **Linea** | `rpc.linea.build` | Consensys backed |
| **Mantle** | `rpc.mantle.xyz` | Bybit backed |
| **zkSync** | `zksync-era.blockpi.network` | zk-rollup |
| **Sepolia** | `sepolia.rpc.subquery.network` | Testnet |

---

## 🛠️ API Endpoints

### Wallet
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet` | Check wallet status |
| POST | `/api/wallet/create` | Create new wallet |
| POST | `/api/wallet/recover` | Recover from mnemonic |
| GET | `/api/balance` | Get balance |
| POST | `/api/send` | Send ETH |

### Vault
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vault` | Vault summary |
| POST | `/api/vault/deploy` | Deploy AntiDrainVault |
| POST | `/api/vault/queue-withdrawal` | Queue a withdrawal |
| POST | `/api/vault/execute-withdrawal` | Execute after delay |
| POST | `/api/vault/cancel-withdrawal` | Cancel queued tx |
| POST | `/api/vault/freeze` | Emergency freeze |
| POST | `/api/vault/unfreeze` | Unfreeze vault |

### Airdrop
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/airdrop/campaign` | Create campaign |
| POST | `/api/airdrop/burner-key` | Get burner key |
| POST | `/api/airdrop/sweep` | Sweep to vault |
| POST | `/api/airdrop/claim` | Claim airdrop |
| GET | `/api/airdrop/hunters` | List campaigns |

---

## 🧪 CLI Usage

```bash
npm run cli
```

Interactive terminal UI for wallet operations without the web server.

---

## 📁 File Structure

```
secure-wallet/
├── contracts/
│   └── AntiDrainVault.sol          # 8-layer smart contract
├── public/
│   └── index.html                  # Web dashboard
├── crypto-engine.js                # Encryption (AES-256-GCM)
├── wallet-manager.js               # EOA operations
├── vault-core.js                   # Vault contract interaction
├── airdrop-burner.js               # Burner EOA + auto-sweep
├── airdrop-hunter.js               # Claim executor
├── airdrop-strategy.js             # Airdrop type definitions
├── server.js                       # Express REST API
├── cli.js                          # Terminal UI
└── storage.js                      # File persistence
```

---

## ⚠️ Security Disclaimer

This is **experimental software**. Use at your own risk. Always:
- Test on testnet first
- Audit the smart contract before mainnet use
- Keep your secondary password separate from your seed phrase
- Store guardian backup keys securely

---

## 📜 License

MIT © iccky
