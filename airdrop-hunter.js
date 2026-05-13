import { ethers } from 'ethers';
import crypto from 'crypto';

// ============================================================================
// AIRDROP HUNTER — Multi-EOA Generator + Claim Detector
// ============================================================================
// Generate unlimited EOA wallets from ONE seed phrase for airdrop farming.
// Path: m/44'/60'/0'/0/N (BIP44 standard)
// Each address can claim airdrop, then auto-sweep to vault.
// ============================================================================

export class AirdropHunter {
  constructor(seedPhrase, vaultAddress) {
    this.mnemonic = seedPhrase;
    this.vaultAddress = vaultAddress;
    this.hdNode = ethers.HDNodeWallet.fromPhrase(seedPhrase);
  }

  // ─── Generate EOA #N from seed phrase ───
  generateAddress(index) {
    const child = this.hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
    return {
      index,
      address: child.address,
      privateKey: child.privateKey,
      path: `m/44'/60'/0'/0/${index}`,
    };
  }

  // ─── Batch generate N addresses ───
  generateBatch(start, count) {
    const wallets = [];
    for (let i = start; i < start + count; i++) {
      wallets.push(this.generateAddress(i));
    }
    return wallets;
  }

  // ─── Get wallet instance by index (for sign/claim) ───
  getWallet(index, provider) {
    const child = this.hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
    return new ethers.Wallet(child.privateKey, provider);
  }

  // ─── Sign message for airdrops that require signature ───
  async signMessage(index, message) {
    const wallet = this.getWallet(index);
    return await wallet.signMessage(message);
  }

  // ─── Sign typed data (EIP-712) for modern airdrops ───
  async signTypedData(index, domain, types, value) {
    const wallet = this.getWallet(index);
    return await wallet.signTypedData(domain, types, value);
  }
}

// ============================================================================
// Airdrop Claim Executor — Interact with claim contract
// ============================================================================

// ABI minimal for MerkleDistributor (Uniswap style)
const MERKLE_ABI = [
  'function claim(uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof) external',
  'function isClaimed(uint256 index) external view returns (bool)',
  'function merkleRoot() external view returns (bytes32)',
];

// ABI for generic claim contract
const CLAIM_ABI = [
  'function claim() external',
  'function claimable(address account) external view returns (uint256)',
  'function claimed(address account) external view returns (bool)',
];

// ABI for airdrop with signature
const SIG_AIRDROP_ABI = [
  'function claim(uint256 amount, bytes calldata signature) external',
  'function claimWithProof(bytes32[] calldata proof, uint256 amount, bytes calldata signature) external',
];

export class AirdropClaimer {
  constructor(provider) {
    this.provider = provider;
  }

  // ─── Claim Merkle Tree Airdrop ───
  async claimMerkle(wallet, contractAddress, index, amount, merkleProof) {
    const contract = new ethers.Contract(contractAddress, MERKLE_ABI, wallet);
    
    // Check if already claimed
    const claimed = await contract.isClaimed(index);
    if (claimed) throw new Error('Already claimed');

    const tx = await contract.claim(index, wallet.address, amount, merkleProof);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() };
  }

  // ─── Claim Generic Airdrop (no args) ───
  async claimGeneric(wallet, contractAddress) {
    const contract = new ethers.Contract(contractAddress, CLAIM_ABI, wallet);
    
    const claimable = await contract.claimable(wallet.address);
    if (claimable == 0) throw new Error('Not eligible or already claimed');

    const tx = await contract.claim();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, amount: claimable.toString() };
  }

  // ─── Claim with Signature (pre-signed off-chain) ───
  async claimWithSignature(wallet, contractAddress, amount, signature) {
    const contract = new ethers.Contract(contractAddress, SIG_AIRDROP_ABI, wallet);
    const tx = await contract.claim(amount, signature);
    const receipt = await tx.wait();
    return { txHash: receipt.hash };
  }

  // ─── Check eligibility without gas ───
  async checkEligibility(contractAddress, userAddress, abiType = 'generic') {
    let abi;
    switch (abiType) {
      case 'merkle': abi = MERKLE_ABI; break;
      case 'generic': abi = CLAIM_ABI; break;
      default: abi = CLAIM_ABI;
    }
    
    const contract = new ethers.Contract(contractAddress, abi, this.provider);
    
    try {
      const claimable = await contract.claimable(userAddress);
      return { eligible: claimable > 0, amount: claimable.toString() };
    } catch {
      return { eligible: false, amount: '0' };
    }
  }
}

// ============================================================================
// Auto-Sweeper — Transfer claimed tokens to vault
// ============================================================================

export class AutoSweeper {
  constructor(vaultAddress, provider) {
    this.vaultAddress = vaultAddress;
    this.provider = provider;
  }

  // ─── Sweep ETH ───
  async sweepETH(wallet, amount = null) {
    const balance = await this.provider.getBalance(wallet.address);
    if (balance == 0n) return { skipped: true, reason: 'Empty' };

    const gasPrice = await this.provider.getFeeData().then(f => f.gasPrice);
    const gasLimit = 21000n;
    const gasCost = gasPrice * gasLimit;
    
    const sendAmount = amount || (balance - gasCost);
    if (sendAmount <= 0n) return { skipped: true, reason: 'Insufficient for gas' };

    const tx = await wallet.sendTransaction({
      to: this.vaultAddress,
      value: sendAmount,
      gasLimit: 21000,
    });
    const receipt = await tx.wait();
    return { txHash: receipt.hash, amount: ethers.formatEther(sendAmount) };
  }

  // ─── Sweep ERC20 Token ───
  async sweepToken(wallet, tokenAddress, tokenSymbol = 'UNKNOWN') {
    const ERC20_ABI = [
      'function balanceOf(address account) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ];
    
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const balance = await token.balanceOf(wallet.address);
    if (balance == 0n) return { skipped: true, reason: 'Empty' };

    const tx = await token.transfer(this.vaultAddress, balance);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, amount: balance.toString(), symbol: tokenSymbol };
  }

  // ─── Batch sweep multiple tokens ───
  async sweepAll(wallet, tokenList) {
    const results = [];
    
    // Sweep ETH first
    const ethResult = await this.sweepETH(wallet);
    results.push({ type: 'ETH', ...ethResult });

    // Sweep each token
    for (const { address, symbol } of tokenList) {
      try {
        const result = await this.sweepToken(wallet, address, symbol);
        results.push({ type: 'ERC20', symbol, ...result });
      } catch (err) {
        results.push({ type: 'ERC20', symbol, error: err.message });
      }
    }
    
    return results;
  }
}

// ============================================================================
// Airdrop Detector — Cek address eligible for airdrop populer
// ============================================================================

export class AirdropDetector {
  constructor(provider) {
    this.provider = provider;
  }

  // Popular airdrop contract addresses (mainnet examples)
  // These would be updated as new airdrops launch
  KNOWN_DROPS = {
    // Layer 2 retroactive drops
    'optimism': '0x...',
    'arbitrum': '0x...',
    'base': '0x...',
    'zksync': '0x...',
    
    // DeFi protocol drops
    'uniswap': '0x...',
    'dydx': '0x...',
    '1inch': '0x...',
    'blur': '0x...',
    
    // Gaming/NFT drops
    'gitcoin': '0x...',
    'ens': '0x...',
  };

  async scanAddress(address) {
    const results = [];
    
    for (const [name, contractAddr] of Object.entries(this.KNOWN_DROPS)) {
      if (!contractAddr || contractAddr === '0x...') continue;
      
      try {
        const claimer = new AirdropClaimer(this.provider);
        const check = await claimer.checkEligibility(contractAddr, address, 'generic');
        if (check.eligible) {
          results.push({ name, contract: contractAddr, eligible: true, amount: check.amount });
        }
      } catch {
        // Skip unsupported contracts
      }
    }
    
    return results;
  }
}

export { MERKLE_ABI, CLAIM_ABI, SIG_AIRDROP_ABI };
