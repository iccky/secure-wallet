/**
 * Transaction Preview — Decode and simulate before signing
 * Shows decoded function calls, token transfers, state changes
 */

import { NETWORKS } from './network.js';

// Common ERC-20/ERC-721 function signatures
const KNOWN_SELECTORS = {
  '0xa9059cbb': { name: 'transfer', type: 'ERC20', params: ['recipient', 'amount'] },
  '0x23b872dd': { name: 'transferFrom', type: 'ERC20', params: ['sender', 'recipient', 'amount'] },
  '0x095ea7b3': { name: 'approve', type: 'ERC20', params: ['spender', 'amount'] },
  '0xd505accf': { name: 'permit', type: 'ERC20', params: ['owner', 'spender', 'value', 'deadline', 'v', 'r', 's'] },
  '0x42842e0e': { name: 'safeTransferFrom', type: 'ERC721', params: ['from', 'to', 'tokenId'] },
  '0xb88d4fde': { name: 'safeTransferFrom', type: 'ERC721', params: ['from', 'to', 'tokenId', 'data'] },
  '0xa22cb465': { name: 'setApprovalForAll', type: 'ERC721', params: ['operator', 'approved'] },
  '0x79cc6790': { name: 'burn', type: 'ERC20', params: ['amount'] },
  '0x2e1a7d4d': { name: 'withdraw', type: 'WETH', params: ['amount'] },
  '0xd0e30db0': { name: 'deposit', type: 'WETH', params: [] },
  '0xf305d719': { name: 'deposit', type: 'Vault', params: ['amount'] },
  '0x8f9a55c0': { name: 'swapExactTokensForTokens', type: 'DEX', params: ['amountIn', 'amountOutMin', 'path', 'to', 'deadline'] },
  '0x8803dbee': { name: 'swapTokensForExactTokens', type: 'DEX', params: ['amountOut', 'amountInMax', 'path', 'to', 'deadline'] },
};

// Common token addresses
const KNOWN_TOKENS = {};

export class TransactionPreview {
  constructor() {
    this.tokenCache = new Map();
  }

  /**
   * Decode and preview transaction
   * Returns: { decoded, summary, stateChanges, humanReadable }
   */
  async preview(tx, chainId) {
    const data = tx.data || '0x';
    const selector = data.slice(0, 10);
    const value = tx.value || '0';
    const to = tx.to;

    const known = KNOWN_SELECTORS[selector];
    
    let decoded = {
      selector,
      functionName: known?.name || 'Unknown Function',
      type: known?.type || 'Unknown',
      params: {},
      raw: data
    };

    // Decode parameters if known
    if (known) {
      decoded.params = this._decodeParams(data, known.params);
    }

    // Build human-readable summary
    const summary = this._buildSummary(decoded, tx, known);

    // Simulate state changes
    const stateChanges = this._simulateChanges(decoded, tx, known);

    return {
      decoded,
      summary,
      stateChanges,
      humanReadable: this._humanReadable(summary, stateChanges)
    };
  }

  // ─── Parameter Decoding ───

  _decodeParams(data, paramNames) {
    const params = {};
    const values = this._extractParams(data);
    
    paramNames.forEach((name, i) => {
      if (values[i]) {
        params[name] = this._formatParam(name, values[i]);
      }
    });
    
    return params;
  }

  _extractParams(data) {
    const paramsData = data.slice(10);
    const params = [];
    
    for (let i = 0; i < paramsData.length; i += 64) {
      params.push('0x' + paramsData.slice(i, i + 64));
    }
    
    return params;
  }

  _formatParam(name, value) {
    if (name.includes('amount') || name.includes('value') || name.includes('shares')) {
      return this._formatTokenAmount(value);
    }
    if (name.includes('address') || name === 'to' || name === 'from' || name === 'recipient' || name === 'spender') {
      return '0x' + value.slice(-40);
    }
    return value;
  }

  _formatTokenAmount(hexValue) {
    try {
      const value = BigInt(hexValue);
      const formatted = Number(value) / 1e18;
      return {
        raw: value.toString(),
        formatted: formatted.toLocaleString('en-US', { maximumFractionDigits: 6 }),
        wei: value.toString()
      };
    } catch {
      return { raw: hexValue, formatted: hexValue, wei: '0' };
    }
  }

  // ─── Summary Builder ───

  _buildSummary(decoded, tx, known) {
    const value = tx.value || '0';
    const ethValue = parseFloat(value) / 1e18;
    
    const summary = {
      type: decoded.type,
      action: decoded.functionName,
      target: tx.to,
      value: {
        eth: ethValue,
        wei: value,
        formatted: ethValue > 0 ? `${ethValue.toFixed(6)} ETH` : '0 ETH'
      },
      tokens: [],
      description: ''
    };

    switch (decoded.functionName) {
      case 'transfer':
        summary.description = `Send ${decoded.params.amount?.formatted || '?'} tokens to ${this._shorten(decoded.params.recipient)}`;
        break;
      case 'approve': {
        const isInfinite = decoded.params.amount?.raw === '115792089237316195423570985008687907853269984665640564039457584007913129639935';
        summary.description = isInfinite 
          ? `⚠️ Grant INFINITE spending power to ${this._shorten(decoded.params.spender)}`
          : `Approve ${decoded.params.amount?.formatted || '?'} tokens for ${this._shorten(decoded.params.spender)}`;
        break;
      }
      case 'setApprovalForAll':
        summary.description = `⚠️ Grant FULL control of ALL NFTs to ${this._shorten(decoded.params.operator)}`;
        break;
      case 'safeTransferFrom':
      case 'transferFrom':
        summary.description = `Transfer NFT #${decoded.params.tokenId} from ${this._shorten(decoded.params.from)} to ${this._shorten(decoded.params.to)}`;
        break;
      default:
        if (ethValue > 0) {
          summary.description = `Send ${ethValue.toFixed(6)} ETH to ${this._shorten(tx.to)}`;
        } else {
          summary.description = `Call ${decoded.functionName} on ${this._shorten(tx.to)}`;
        }
    }

    return summary;
  }

  // ─── State Change Simulation ───

  _simulateChanges(decoded, tx, known) {
    const changes = [];
    
    switch (decoded.functionName) {
      case 'approve':
        changes.push({
          type: 'ALLOWANCE',
          asset: 'Token',
          spender: decoded.params.spender,
          change: 'INCREASED',
          impact: decoded.params.amount?.raw?.length > 30 ? 'UNLIMITED' : 'LIMITED'
        });
        break;
      case 'transfer':
        changes.push({
          type: 'BALANCE',
          asset: 'Token',
          direction: 'OUT',
          amount: decoded.params.amount,
          recipient: decoded.params.recipient
        });
        break;
      case 'setApprovalForAll':
        changes.push({
          type: 'APPROVAL_FOR_ALL',
          asset: 'NFT Collection',
          operator: decoded.params.operator,
          change: 'GRANTED_FULL'
        });
        break;
      case 'transferFrom':
      case 'safeTransferFrom':
        changes.push({
          type: 'NFT_TRANSFER',
          asset: 'NFT',
          tokenId: decoded.params.tokenId,
          from: decoded.params.from,
          to: decoded.params.to
        });
        break;
    }

    // ETH value change
    const value = parseFloat(tx.value || '0');
    if (value > 0) {
      changes.push({
        type: 'BALANCE',
        asset: 'ETH',
        direction: 'OUT',
        amount: {
          formatted: (value / 1e18).toFixed(6),
          wei: value.toString()
        }
      });
    }

    return changes;
  }

  // ─── Human Readable ───

  _humanReadable(summary, stateChanges) {
    const parts = [summary.description];
    
    if (stateChanges.length > 0) {
      parts.push('\n\nState changes:');
      stateChanges.forEach(change => {
        switch (change.type) {
          case 'ALLOWANCE':
            parts.push(`  • Your token allowance to ${this._shorten(change.spender)} will be ${change.impact === 'UNLIMITED' ? 'SET TO UNLIMITED' : 'increased'}`);
            break;
          case 'BALANCE':
            parts.push(`  • Your ${change.asset} balance will decrease by ${change.amount?.formatted || '?'}`);
            break;
          case 'APPROVAL_FOR_ALL':
            parts.push(`  • ${this._shorten(change.operator)} will be able to transfer ALL your NFTs from this collection`);
            break;
          case 'NFT_TRANSFER':
            parts.push(`  • NFT #${change.tokenId} will be transferred to ${this._shorten(change.to)}`);
            break;
        }
      });
    }
    
    return parts.join('\n');
  }

  // ─── Helpers ───

  _shorten(addr) {
    if (!addr) return '?';
    const clean = addr.replace(/^0x0*/, '0x');
    return clean.length > 12 ? `${clean.slice(0, 6)}...${clean.slice(-4)}` : clean;
  }
}
