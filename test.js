import { encrypt, decrypt, hashPassword, verifyPassword, createWallet, recoverWallet } from './crypto-engine.js';

async function runTests() {
  console.log('🔐 Running Secure Wallet Tests...\n');

  let pass = 0, fail = 0;

  function assert(condition, msg) {
    if (condition) { console.log(`  ✅ ${msg}`); pass++; }
    else { console.log(`  ❌ ${msg}`); fail++; }
  }

  // Test 1: Encrypt/Decrypt
  console.log('1. AES-256-GCM Encryption');
  const secret = 'test-secret-123';
  const password = 'myStrongP@ssw0rd';
  const encrypted = encrypt(secret, password);
  const decrypted = decrypt(encrypted, password);
  assert(decrypted === secret, 'Encrypt/decrypt roundtrip works');

  // Test 2: Wrong password fails
  let wrongPassFailed = false;
  try { decrypt(encrypted, 'wrongpassword'); } catch { wrongPassFailed = true; }
  assert(wrongPassFailed, 'Wrong password fails decryption');

  // Test 3: Password hash
  console.log('\n2. Bcrypt Password Hash');
  const hash = await hashPassword(password);
  assert(hash.startsWith('$2'), 'Hash is bcrypt format');
  assert(await verifyPassword(password, hash), 'Correct password verifies');
  assert(!(await verifyPassword('wrong', hash)), 'Wrong password rejected');

  // Test 4: Wallet creation
  console.log('\n3. Wallet Creation');
  const wallet = await createWallet('SecurePass123!');
  assert(wallet.address.startsWith('0x'), 'Address generated');
  assert(wallet.mnemonic.split(' ').length === 12, '12-word mnemonic');
  assert(wallet.encryptedPrivateKey.includes(':'), 'Private key encrypted');
  assert(wallet.passwordHash.startsWith('$2'), 'Password hash stored');

  // Test 5: Wallet recovery
  console.log('\n4. Wallet Recovery');
  const recovered = await recoverWallet(wallet.mnemonic, 'NewPass456!');
  assert(recovered.address === wallet.address, 'Recovery produces same address');

  console.log('\n' + '─'.repeat(40));
  console.log(`Results: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests();
