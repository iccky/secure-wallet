import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { ethers } from 'ethers';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 600000;

/**
 * Derive encryption key from password + salt using PBKDF2-SHA512
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt plaintext with AES-256-GCM
 * Returns: salt:iv:tag:ciphertext (hex)
 */
export function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt ciphertext with AES-256-GCM
 * Throws on wrong password or tampered data
 */
export function decrypt(ciphertext, password) {
  const [saltHex, ivHex, tagHex, encryptedHex] = ciphertext.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Hash secondary password with bcrypt (slow hash for brute-force resistance)
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate cryptographically secure random bytes as hex
 */
export function secureRandomBytes(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Create mnemonic + encrypted keystore
 */
export async function createWallet(secondaryPassword) {
  const wallet = ethers.Wallet.createRandom();
  const mnemonic = wallet.mnemonic.phrase;
  const privateKey = wallet.privateKey;
  const address = wallet.address;

  // Encrypt private key with secondary password
  const encryptedPk = encrypt(privateKey, secondaryPassword);

  // Hash secondary password for verification
  const passwordHash = await hashPassword(secondaryPassword);

  return {
    address,
    mnemonic,
    encryptedPrivateKey: encryptedPk,
    passwordHash,
    createdAt: new Date().toISOString()
  };
}

/**
 * Recover wallet from mnemonic, then encrypt with new secondary password
 */
export async function recoverWallet(mnemonic, secondaryPassword) {
  const wallet = ethers.Wallet.fromPhrase(mnemonic);
  const encryptedPk = encrypt(wallet.privateKey, secondaryPassword);
  const passwordHash = await hashPassword(secondaryPassword);

  return {
    address: wallet.address,
    encryptedPrivateKey: encryptedPk,
    passwordHash,
    recoveredAt: new Date().toISOString()
  };
}

/**
 * Decrypt private key using secondary password, then sign tx
 * This is the CRITICAL security function
 */
export async function signTransaction(encryptedPk, secondaryPassword, passwordHash, txRequest, provider) {
  // Step 1: Verify secondary password
  const valid = await verifyPassword(secondaryPassword, passwordHash);
  if (!valid) {
    throw new Error('SECONDARY_PASSWORD_INVALID: Wrong secondary password. Transaction rejected.');
  }

  // Step 2: Decrypt private key
  let privateKey;
  try {
    privateKey = decrypt(encryptedPk, secondaryPassword);
  } catch (err) {
    throw new Error('DECRYPTION_FAILED: Cannot decrypt private key. Password may be wrong or data corrupted.');
  }

  // Step 3: Create wallet instance and sign
  const wallet = new ethers.Wallet(privateKey, provider);
  const signedTx = await wallet.signTransaction(txRequest);

  // Step 4: Clear sensitive data from memory
  privateKey = null;

  return signedTx;
}

/**
 * Send transaction with secondary password verification
 */
export async function sendTransaction(encryptedPk, secondaryPassword, passwordHash, txRequest, provider) {
  const signedTx = await signTransaction(encryptedPk, secondaryPassword, passwordHash, txRequest, provider);
  const response = await provider.broadcastTransaction(signedTx);
  return response;
}
