/**
 * Network Configurations — EVM chain definitions
 */

export const NETWORKS = {
  ethereum: {
    name: 'Ethereum',
    chainId: '0x1',
    rpcUrl: 'https://eth.llamarpc.com',
    symbol: 'ETH',
    explorer: 'https://etherscan.io'
  },
  base: {
    name: 'Base',
    chainId: '0x2105',
    rpcUrl: 'https://base.llamarpc.com',
    symbol: 'ETH',
    explorer: 'https://basescan.org'
  },
  optimism: {
    name: 'Optimism',
    chainId: '0xa',
    rpcUrl: 'https://optimism.llamarpc.com',
    symbol: 'ETH',
    explorer: 'https://optimistic.etherscan.io'
  },
  arbitrum: {
    name: 'Arbitrum',
    chainId: '0xa4b1',
    rpcUrl: 'https://arbitrum.llamarpc.com',
    symbol: 'ETH',
    explorer: 'https://arbiscan.io'
  },
  polygon: {
    name: 'Polygon',
    chainId: '0x89',
    rpcUrl: 'https://polygon.llamarpc.com',
    symbol: 'MATIC',
    explorer: 'https://polygonscan.com'
  },
  bnb: {
    name: 'BNB Chain',
    chainId: '0x38',
    rpcUrl: 'https://binance.llamarpc.com',
    symbol: 'BNB',
    explorer: 'https://bscscan.com'
  }
};
