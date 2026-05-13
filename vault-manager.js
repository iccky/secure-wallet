import { ethers } from 'ethers';
import fs from 'fs/promises';
import path from 'path';
import { encrypt, decrypt } from './crypto-engine.js';
import { loadWallet } from './storage.js';

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
  "event WithdrawalCancelled(address indexed by)"
];

// Compile TimeLockVault.sol to get bytecode
async function compileContract() {
  const solc = await import('solc');
  const source = await fs.readFile('./contracts/TimeLockVault.sol', 'utf8');
  
  const input = {
    language: 'Solidity',
    sources: {
      'TimeLockVault.sol': { content: source }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object']
        }
      },
      optimizer: { enabled: true, runs: 200 }
    }
  };
  
  const output = JSON.parse(solc.default.compile(JSON.stringify(input)));
  const contract = output.contracts['TimeLockVault.sol'].TimeLockVault;
  
  return {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object
  };
}

export async function deployVault(privateKey, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  const { abi, bytecode } = await compileContract();
  
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  
  // Save vault info
  const dataDir = './data';
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'vault.json'),
    JSON.stringify({ address, owner: wallet.address, deployedAt: new Date().toISOString() }, null, 2)
  );
  
  return { address, abi };
}

export async function getVaultContract(rpcUrl) {
  const vaultInfo = await fs.readFile('./data/vault.json', 'utf8').then(JSON.parse).catch(() => null);
  if (!vaultInfo) throw new Error('No vault deployed. Deploy one first.');
  
  const { abi } = await compileContract();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Contract(vaultInfo.address, abi, provider);
}

export async function depositToVault(privateKey, rpcUrl, amountEth) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = await getVaultContract(rpcUrl);
  
  const tx = await vault.connect(wallet).deposit({ value: ethers.parseEther(amountEth) });
  await tx.wait();
  return tx.hash;
}

export async function initiateVaultWithdrawal(privateKey, rpcUrl, amountEth, to) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = await getVaultContract(rpcUrl);
  
  const tx = await vault.connect(wallet).initiateWithdrawal(ethers.parseEther(amountEth), to);
  await tx.wait();
  return tx.hash;
}

export async function completeVaultWithdrawal(privateKey, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = await getVaultContract(rpcUrl);
  
  const tx = await vault.connect(wallet).completeWithdrawal();
  await tx.wait();
  return tx.hash;
}

export async function cancelVaultWithdrawal(privateKey, rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = await getVaultContract(rpcUrl);
  
  const tx = await vault.connect(wallet).cancelWithdrawal();
  await tx.wait();
  return tx.hash;
}

export async function getVaultBalance(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.getVaultBalance();
}

export async function getPendingWithdrawal(rpcUrl) {
  const vault = await getVaultContract(rpcUrl);
  return vault.getPendingWithdrawal();
}
