import { ethers } from 'ethers';

// ============================================================================
// AIRDROP STRATEGY CONFIG — Pola Claim & Compatibility Matrix
// ============================================================================

export const AIRDROP_TYPES = {
  // ─── Type 1: Snapshot (No Action Required) ──────────────────────────────
  // Protocol takes a snapshot, airdrop automatically sent to address
  // Contoh: Optimism Phase 1, some retroactive drops
  SNAPSHOT: {
    id: 'snapshot',
    name: 'Snapshot Airdrop',
    requiresAction: false,
    requiresSignature: false,
    scWalletCompatible: true,
    description: 'Tokens sent directly to address. No claim required.',
    vaultAction: 'WAIT — tokens will automatically enter the vault address',
  },

  // ─── Type 2: Merkle Tree Claim ──────────────────────────────────────────
  // User must call claim() with merkleProof
  // Examples: Uniswap UNI, dYdX, 1inch, ENS
  MERKLE: {
    id: 'merkle',
    name: 'Merkle Tree Claim',
    requiresAction: true,
    requiresSignature: true,
    scWalletCompatible: true, // SC can call claim()
    description: 'Call claim() on contract with merkle proof. SC wallet CAN do this.',
    vaultAction: 'OWNER signs claim tx → guardian approves → 24h queue → execute',
    sampleContracts: [
      { name: 'Uniswap UNI', chain: 'ethereum', address: '0x090D4613473dEE047c3f2706c05dE5062272f50' },
      { name: 'dYdX', chain: 'ethereum', address: '0x6397C1ae477E82C5B5eFF38A0257a000d4E5E2Dc' },
      { name: '1inch', chain: 'ethereum', address: '0xE295aD71242373C37C5FdA7B57F26f9eA1088AFe' },
      { name: 'ENS', chain: 'ethereum', address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72' },
    ],
  },

  // ─── Type 3: Signature Claim (EIP-712 / Message) ────────────────────────
  // User must sign message or typed data off-chain, then submit
  // Examples: Some Galxe, Layer3, custom verification
  SIGNATURE: {
    id: 'signature',
    name: 'Signature Verification',
    requiresAction: true,
    requiresSignature: true,
    scWalletCompatible: false, // SC does not have a private key to sign
    description: 'Sign message/EIP-712 off-chain. SC wallet CANNOT sign.',
    vaultAction: 'MUST use EOA hunter address. Claim → sweep to vault.',
    workaround: 'Use EOA hunter wallet to sign, then sweep tokens to vault.',
  },

  // ─── Type 4: Quest/Task-Based ───────────────────────────────────────────
  // Bridge, swap, deposit, interact with protocol → eligible
  // Examples: Arbitrum Odyssey, zkSync DeFi spring
  QUEST: {
    id: 'quest',
    name: 'Quest/Task-Based',
    requiresAction: true,
    requiresSignature: true,
    scWalletCompatible: false, // Requires active interaction, gas-efficient to use EOA
    description: 'Bridge, swap, deposit for eligibility. More efficient to use EOA.',
    vaultAction: 'Use EOA hunter for quest. Results swept to vault.',
    popularQuests: [
      { name: 'Arbitrum Odyssey', tasks: ['Bridge', 'Swap', 'NFT mint'] },
      { name: 'zkSync Era DeFi', tasks: ['Deposit', 'Swap', 'LP'] },
      { name: 'Base Onchain Summer', tasks: ['Mint', 'Swap', 'Bridge'] },
      { name: 'Linea Voyage', tasks: ['Bridge', 'Swap', 'NFT'] },
      { name: 'Scroll Session', tasks: ['Deposit', 'Swap', 'Mint'] },
    ],
  },

  // ─── Type 5: Token-Gated / Hold ─────────────────────────────────────────
  // Hold token X → receive token Y
  // Examples: Governance airdrops, NFT holder drops
  HOLD: {
    id: 'hold',
    name: 'Token-Gated / Holder',
    requiresAction: false,
    requiresSignature: false,
    scWalletCompatible: true,
    description: 'Hold specific token/NFT → airdrop automatic.',
    vaultAction: 'Buy & hold token in vault. Snapshot automatically detects balance.',
  },

  // ─── Type 6: Social/Invite ──────────────────────────────────────────────
  // Refer friends, share link, social tasks
  // Examples: Some Telegram bots, friend.tech style
  SOCIAL: {
    id: 'social',
    name: 'Social / Invite',
    requiresAction: true,
    requiresSignature: false,
    scWalletCompatible: false, // Social tasks are off-chain
    description: 'Referral link, social media tasks. Off-chain activity.',
    vaultAction: 'Use EOA hunter to generate referral. Reward swept to vault.',
  },
};

// ============================================================================
// Chain-Specific Airdrop Opportunities (Updated Periodically)
// ============================================================================

export const ACTIVE_DROPS = {
  // Layer 2 Retroactive
  layer2: [
    {
      name: 'Optimism',
      type: 'snapshot',
      status: 'ended',
      note: 'OP Retroactive already distributed. Future rounds possible.',
    },
    {
      name: 'Arbitrum',
      type: 'merkle',
      status: 'ended',
      note: 'ARB distributed. Odyssey quests ongoing.',
    },
    {
      name: 'zkSync',
      type: 'quest',
      status: 'active',
      note: 'zkSync DeFi Spring — deposit, swap, LP on zkSync Era.',
    },
    {
      name: 'Starknet',
      type: 'merkle',
      status: 'ended',
      note: 'STRK distributed. Future incentive programs.',
    },
    {
      name: 'Base',
      type: 'quest',
      status: 'active',
      note: 'Base Onchain Summer — ongoing quests and NFT mints.',
    },
    {
      name: 'Linea',
      type: 'quest',
      status: 'active',
      note: 'Linea Voyage — bridge, swap, NFT tasks.',
    },
    {
      name: 'Scroll',
      type: 'quest',
      status: 'active',
      note: 'Scroll Sessions — deposit, swap, mint.',
    },
    {
      name: 'Mantle',
      type: 'quest',
      status: 'active',
      note: 'Mantle Journey — bridge, DeFi tasks.',
    },
    {
      name: 'Blast',
      type: 'hold',
      status: 'ended',
      note: 'Blast Gold distributed to early users.',
    },
  ],

  // DeFi Protocols
  defi: [
    {
      name: 'EigenLayer',
      type: 'hold',
      status: 'active',
      note: 'Restake ETH → EIGEN token. Ongoing seasons.',
    },
    {
      name: 'Ether.fi',
      type: 'hold',
      status: 'active',
      note: 'Stake ETH → eETH → ETHFI rewards.',
    },
    {
      name: 'Pendle',
      type: 'hold',
      status: 'active',
      note: 'YT/LP → PENDLE rewards. Seasonal.',
    },
    {
      name: 'Jito (Solana)',
      type: 'merkle',
      status: 'ended',
      note: 'JTO distributed. Future seasons possible.',
    },
    {
      name: 'Jupiter (Solana)',
      type: 'merkle',
      status: 'ended',
      note: 'JUP distributed. Airdrop 2 possible.',
    },
  ],

  // NFT/Gaming
  nft: [
    {
      name: 'Blur',
      type: 'merkle',
      status: 'ended',
      note: 'BLUR distributed. Season 3 ongoing.',
    },
    {
      name: 'Magic Eden',
      type: 'quest',
      status: 'active',
      note: 'Diamonds program — trade, list, buy NFTs.',
    },
  ],
};

// ============================================================================
// Compatibility Checker
// ============================================================================

export function checkAirdropCompatibility(airdropType) {
  const type = AIRDROP_TYPES[airdropType.toUpperCase()];
  if (!type) return { compatible: false, reason: 'Unknown airdrop type' };
  
  return {
    compatible: type.scWalletCompatible,
    directVaultClaim: type.scWalletCompatible,
    requiresEOA: !type.scWalletCompatible,
    description: type.description,
    vaultAction: type.vaultAction,
  };
}

// ============================================================================
// Airdrop Execution Plan Generator
// ============================================================================

export function generateAirdropPlan(address, airdrops) {
  const plan = {
    address,
    totalEligible: 0,
    directVault: [], // Can claim directly to vault
    needsEOA: [],    // Need EOA hunter, then sweep
    steps: [],
  };

  for (const drop of airdrops) {
    const compat = checkAirdropCompatibility(drop.type);
    
    if (compat.directVaultClaim) {
      plan.directVault.push(drop);
      plan.steps.push({
        action: 'DIRECT_CLAIM',
        drop: drop.name,
        contract: drop.contract,
        note: 'Queue claim tx → guardian approve → wait 24h → execute',
      });
    } else {
      plan.needsEOA.push(drop);
      plan.steps.push({
        action: 'EOA_CLAIM_THEN_SWEEP',
        drop: drop.name,
        note: 'Use EOA hunter wallet → claim → sweep to vault',
      });
    }
  }

  return plan;
}

// ============================================================================
// RPC Endpoints by Chain (for multi-chain airdrop hunting)
// ============================================================================

export const CHAIN_RPCS = {
  ethereum: 'https://eth.llamarpc.com',
  base: 'https://base.llamarpc.com',
  optimism: 'https://optimism.llamarpc.com',
  arbitrum: 'https://arbitrum.llamarpc.com',
  zkSync: 'https://zksync-era.blockpi.network/v1/rpc/public',
  scroll: 'https://rpc.scroll.io',
  linea: 'https://rpc.linea.build',
  mantle: 'https://rpc.mantle.xyz',
  blast: 'https://rpc.blast.io',
  bsc: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon.llamarpc.com',
  avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
  fantom: 'https://rpc.ankr.com/fantom',
  // Testnets
  sepolia: 'https://ethereum-sepolia.rpc.subquery.network/public',
  baseSepolia: 'https://sepolia.base.org',
  opSepolia: 'https://sepolia.optimism.io',
};

export const CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
  optimism: 10,
  arbitrum: 42161,
  zkSync: 324,
  scroll: 534352,
  linea: 59144,
  mantle: 5000,
  blast: 81457,
  bsc: 56,
  polygon: 137,
  avalanche: 43114,
  fantom: 250,
  sepolia: 11155111,
  baseSepolia: 84532,
  opSepolia: 11155420,
};

// ============================================================================
// Gas Strategy — Which chain to use for airdrop hunting
// ============================================================================

export const GAS_STRATEGY = {
  // Cheap chains for quest-based airdrops
  cheap: ['base', 'optimism', 'arbitrum', 'mantle', 'scroll'],
  
  // Moderate cost
  moderate: ['polygon', 'bsc', 'avalanche'],
  
  // Expensive (only for high-value claims)
  expensive: ['ethereum'],
  
  // Recommended priority for new airdrop hunter
  recommendedPriority: [
    'base',      // Coinbase backed, many quests
    'optimism',  // OP Stack, Superchain
    'arbitrum',  // Biggest L2
    'scroll',    // zkEVM, early stage
    'linea',     // Consensys backed
    'mantle',    // Bybit backed
  ],
};

// ============================================================================
// Airdrop Calendar / Tracker Template
// ============================================================================

export function createAirdropTracker() {
  return {
    wallets: [], // Array of { index, address, chainActivities }
    trackedDrops: [],
    claimed: [],
    pending: [],
    sweptToVault: [],
    
    addWallet(index, address) {
      this.wallets.push({ index, address, chains: {}, drops: [] });
    },
    
    markActivity(address, chain, activity) {
      const w = this.wallets.find(w => w.address === address);
      if (w) {
        w.chains[chain] = w.chains[chain] || [];
        w.chains[chain].push({ activity, timestamp: Date.now() });
      }
    },
    
    addDrop(drop) {
      this.trackedDrops.push({ ...drop, addedAt: Date.now() });
    },
  };
}
