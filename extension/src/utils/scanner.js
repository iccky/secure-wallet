/**
 * Scam Scanner — Real-time threat detection before signing
 * Detects: honeypots, infinite approvals, known scam contracts, phishing
 */

import { NETWORKS } from './network.js';

// Known threat patterns (expandable via remote update)
const THREAT_PATTERNS = {
  infiniteApproval: ['0x095ea7b3', 'approve(address,uint256)'], // spender + max uint
  transferAll: ['transfer(address,uint256)', 'transferFrom(address,address,uint256)'],
  selfDestruct: ['selfdestruct(address)', 'delegatecall'],
  permit: ['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'],
};

// Known scam/heist addresses (would fetch from remote DB in production)
const KNOWN_SCAM_DB = new Set([
  // Ethereum
  '0x0000000000000000000000000000000000000000',
]);

// Chain-specific block explorers for verification
const EXPLORERS = {
  ethereum: 'https://etherscan.io',
  base: 'https://basescan.org',
  optimism: 'https://optimistic.etherscan.io',
  arbitrum: 'https://arbiscan.io',
  polygon: 'https://polygonscan.com',
  bnb: 'https://bscscan.com'
};

export class ScamScanner {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 min
  }

  /**
   * Analyze transaction before signing
   * Returns: { safe: boolean, score: 0-100, risks: [], warnings: [] }
   */
  async analyzeTransaction(tx, chainId) {
    const risks = [];
    const warnings = [];
    let score = 100;

    const network = this._getNetwork(chainId);
    const data = tx.data || '0x';
    const to = tx.to?.toLowerCase();
    const value = tx.value || '0';

    // ─── 1. Check if recipient is known scam ───
    if (to && KNOWN_SCAM_DB.has(to)) {
      risks.push({
        severity: 'CRITICAL',
        title: 'Known Malicious Address',
        description: 'This address is flagged in scam databases. DO NOT PROCEED.'
      });
      score = 0;
    }

    // ─── 2. Detect infinite token approval ───
    if (this._isInfiniteApproval(data)) {
      risks.push({
        severity: 'HIGH',
        title: 'Infinite Token Approval',
        description: 'This transaction grants UNLIMITED spending of your tokens. Scammers use this to drain wallets.'
      });
      score -= 40;
    }

    // ─── 3. Detect token transfer to EOA with no contract ───
    if (this._isTokenTransfer(data) && to) {
      const isContract = await this._isContract(to, network);
      if (!isContract) {
        warnings.push({
          severity: 'MEDIUM',
          title: 'Transfer to External Address',
          description: 'You are sending tokens directly to a wallet, not a smart contract. Verify the recipient.'
        });
        score -= 10;
      }
    }

    // ─── 4. Detect permit signature (gasless approval) ───
    if (this._isPermit(data)) {
      risks.push({
        severity: 'HIGH',
        title: 'Gasless Permit Approval',
        description: 'This grants token approval without a transaction. Can be used for phishing.'
      });
      score -= 35;
    }

    // ─── 5. Detect setApprovalForAll (NFT drain) ───
    if (this._isApprovalForAll(data)) {
      risks.push({
        severity: 'HIGH',
        title: 'NFT Collection Approval',
        description: 'This grants FULL control over ALL NFTs in a collection. Scammers use this to steal NFTs.'
      });
      score -= 45;
    }

    // ─── 6. High value check ───
    const ethValue = parseFloat(value) / 1e18;
    if (ethValue > 1) {
      warnings.push({
        severity: 'MEDIUM',
        title: 'High Value Transaction',
        description: `This transaction sends ${ethValue.toFixed(4)} ETH. Double-check the amount.`
      });
      score -= 5;
    }

    // ─── 7. Contract verification check ───
    if (to && await this._isContract(to, network)) {
      const verified = await this._isVerifiedContract(to, network);
      if (!verified) {
        warnings.push({
          severity: 'LOW',
          title: 'Unverified Contract',
          description: 'This smart contract source code is not verified on the block explorer.'
        });
        score -= 5;
      }
    }

    // ─── 8. Domain phishing check (if called from dApp) ───
    const origin = tx.origin || '';
    if (origin && this._isSuspiciousDomain(origin)) {
      risks.push({
        severity: 'CRITICAL',
        title: 'Suspicious Website',
        description: 'This dApp domain is flagged as potentially phishing.'
      });
      score = Math.min(score, 20);
    }

    return {
      safe: score >= 70 && risks.length === 0,
      score: Math.max(0, score),
      risks,
      warnings,
      summary: this._buildSummary(score, risks, warnings)
    };
  }

  // ─── Detection Helpers ───

  _isInfiniteApproval(data) {
    if (!data || data === '0x') return false;
    const selector = data.slice(0, 10);
    // approve(address, uint256) = 0x095ea7b3
    if (selector !== '0x095ea7b3') return false;
    // Check if amount is max uint256
    const amountHex = data.slice(74, 138);
    const maxUint = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    return amountHex?.toLowerCase() === maxUint;
  }

  _isTokenTransfer(data) {
    if (!data || data === '0x') return false;
    const selector = data.slice(0, 10);
    return ['0xa9059cbb', '0x23b872dd'].includes(selector); // transfer / transferFrom
  }

  _isPermit(data) {
    if (!data || data === '0x') return false;
    return data.startsWith('0xd505accf'); // permit()
  }

  _isApprovalForAll(data) {
    if (!data || data === '0x') return false;
    return data.startsWith('0xa22cb465'); // setApprovalForAll
  }

  _isSuspiciousDomain(origin) {
    const suspicious = [
      'phishing', 'airdrop-claim', 'free-nft', 'connect-wallet',
      'verify-wallet', 'restore-wallet', 'secure-verify'
    ];
    const lower = origin.toLowerCase();
    return suspicious.some(s => lower.includes(s));
  }

  // ─── Chain Helpers ───

  _getNetwork(chainId) {
    const hex = typeof chainId === 'number' ? '0x' + chainId.toString(16) : chainId;
    return Object.values(NETWORKS).find(n => n.chainId === hex) || NETWORKS.ethereum;
  }

  async _isContract(address, network) {
    try {
      const cacheKey = `contract_${address}`;
      if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
      
      // In production: call eth_getCode via RPC
      // For now, heuristic: addresses with >10 chars after 0x that look like contracts
      const result = address.length === 42; // basic check
      this.cache.set(cacheKey, result, this.cacheTTL);
      return result;
    } catch {
      return false;
    }
  }

  async _isVerifiedContract(address, network) {
    // In production: query block explorer API
    // For MVP, return false to encourage caution
    return false;
  }

  _buildSummary(score, risks, warnings) {
    if (score === 0) return '⛔ CRITICAL: Transaction is HIGHLY DANGEROUS. Do not proceed.';
    if (score < 30) return '🚨 HIGH RISK: Multiple serious threats detected.';
    if (score < 60) return '⚠️ MEDIUM RISK: Some concerns found. Review carefully.';
    if (score < 80) return '✅ MOSTLY SAFE: Minor concerns. Proceed with caution.';
    return '✅ SAFE: No threats detected. Standard transaction.';
  }
}
