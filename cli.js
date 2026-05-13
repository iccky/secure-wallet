#!/usr/bin/env node
import readline from 'readline';
import walletManager from './wallet-manager.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(resolve => {
    // Hide password input
    if (q.toLowerCase().includes('password')) {
      process.stdout.write(q + ' ');
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      let input = '';
      const onData = (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        }
        if (char === '\u0003') { process.exit(); }
        if (char === '\u007f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += char;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(q + ' ', resolve);
    }
  });
}

async function menu() {
  console.clear();
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║        🔐  SECURE WALLET CLI v1.0.0           ║');
  console.log('║   Seed leak? No problem. Password required.   ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log();

  const exists = await walletManager.walletExists();
  if (exists) {
    const info = await walletManager.getWalletInfo();
    console.log(`📍 Address: ${info.address}`);
    console.log(`💰 Balance: ${info.balance} ETH`);
    console.log();
    console.log('1. Send Transaction');
    console.log('2. View Transaction History');
    console.log('3. View Settings');
    console.log('4. Delete Wallet');
    console.log('5. Exit');
    console.log();
    const choice = await ask('Select (1-5):');

    if (choice === '1') {
      const to = await ask('Recipient address:');
      const amount = await ask('Amount (ETH):');
      const pw = await ask('Secondary password:');
      console.log('⏳ Signing & broadcasting...');
      try {
        const result = await walletManager.sendTransaction(pw, { to, amount });
        console.log('✅ Transaction sent!');
        console.log(`   Hash: ${result.hash}`);
        console.log(`   Explorer: ${result.explorer}`);
      } catch (e) {
        console.log(`❌ Error: ${e.message}`);
      }
      await ask('\nPress Enter to continue...');
      menu();
    } else if (choice === '2') {
      const logs = await walletManager.getTxHistory();
      console.log('\n📜 Transaction History:');
      if (!logs.length) console.log('   No transactions yet.');
      logs.slice().reverse().forEach((tx, i) => {
        console.log(`   ${i+1}. ${tx.hash?.slice(0,20)}... → ${tx.to?.slice(0,12)}... | ${tx.amount} ETH | ${tx.status}`);
      });
      await ask('\nPress Enter to continue...');
      menu();
    } else if (choice === '3') {
      const s = await walletManager.getSettings();
      console.log(`\n⚙️  RPC: ${s.rpcUrl}`);
      console.log(`   Chain ID: ${s.chainId}`);
      await ask('\nPress Enter to continue...');
      menu();
    } else if (choice === '4') {
      const confirm = await ask('Type DELETE to confirm wallet deletion:');
      if (confirm === 'DELETE') {
        await walletManager.deleteWallet();
        console.log('Wallet deleted.');
      } else {
        console.log('Cancelled.');
      }
      await ask('\nPress Enter to continue...');
      menu();
    } else {
      console.log('Goodbye! 👋');
      process.exit(0);
    }
  } else {
    console.log('No wallet found.');
    console.log('1. Create New Wallet');
    console.log('2. Recover from Seed Phrase');
    console.log('3. Exit');
    console.log();
    const choice = await ask('Select (1-3):');

    if (choice === '1') {
      const pw1 = await ask('Set secondary password (min 8 chars):');
      if (pw1.length < 8) {
        console.log('❌ Password too short.');
        await ask('Press Enter to continue...');
        return menu();
      }
      const pw2 = await ask('Confirm password:');
      if (pw1 !== pw2) {
        console.log('❌ Passwords do not match.');
        await ask('Press Enter to continue...');
        return menu();
      }
      const result = await walletManager.createWallet(pw1);
      console.log('\n🎉 Wallet created!');
      console.log(`   Address: ${result.address}`);
      console.log('\n⚠️  BACKUP THIS MNEMONIC NOW:');
      console.log(`   ${result.mnemonic}`);
      console.log('\n   This is the ONLY way to recover your wallet.');
      await ask('\nPress Enter after saving your mnemonic...');
      menu();
    } else if (choice === '2') {
      const mnemonic = await ask('Enter 12-word seed phrase:');
      const pw = await ask('Set new secondary password:');
      if (pw.length < 8) {
        console.log('❌ Password too short.');
        await ask('Press Enter to continue...');
        return menu();
      }
      const result = await walletManager.recoverWallet(mnemonic, pw);
      console.log('\n✅ Wallet recovered!');
      console.log(`   Address: ${result.address}`);
      await ask('\nPress Enter to continue...');
      menu();
    } else {
      console.log('Goodbye! 👋');
      process.exit(0);
    }
  }
}

menu();
