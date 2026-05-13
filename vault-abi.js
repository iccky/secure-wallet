import { ethers } from 'ethers';
import fs from 'fs/promises';

const VAULT_ABI = [
  "constructor()",
  "function owner() view returns (address)",
  "function initiateWithdrawal(uint256 amount, address to)",
  "function completeWithdrawal()",
  "function cancelWithdrawal()",
  "function emergencyWithdraw()",
  "function transferOwnership(address newOwner)",
  "function getVaultBalance() view returns (uint256)",
  "function getPendingWithdrawal() view returns (tuple(uint256 amount, address to, uint256 unlockTime, bool active))",
  "event WithdrawalInitiated(uint256 amount, address indexed to, uint256 unlockTime)",
  "event WithdrawalCompleted(uint256 amount, address indexed to)",
  "event WithdrawalCancelled(address indexed by)",
  "receive() external payable"
];

const VAULT_BYTECODE = "0x" + await fs.readFile('./contracts/TimeLockVault.bin', 'utf8').catch(() => '');

export { VAULT_ABI, VAULT_BYTECODE };
