/**
 * Crypto Engine — Browser-compatible encryption
 * Replaces Node crypto with Web Crypto API
 */

export class CryptoEngine {
  constructor() {
    this.ALGO = 'AES-GCM';
    this.IV_LENGTH = 12;
    this.SALT_LENGTH = 32;
    this.TAG_LENGTH = 16;
    this.KEY_LENGTH = 32;
    this.ITERATIONS = 600000;
  }

  /**
   * Derive key from password using PBKDF2
   */
  async deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.ITERATIONS,
        hash: 'SHA-512'
      },
      keyMaterial,
      { name: this.ALGO, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    
    return derivedKey;
  }

  /**
   * Encrypt plaintext → salt:iv:ciphertext (base64)
   */
  async encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const key = await this.deriveKey(password, salt);
    
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: this.ALGO, iv },
      key,
      data
    );
    
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt base64 ciphertext
   */
  async decrypt(ciphertext, password) {
    const combined = new Uint8Array(
      atob(ciphertext).split('').map(c => c.charCodeAt(0))
    );
    
    const salt = combined.slice(0, this.SALT_LENGTH);
    const iv = combined.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
    const encrypted = combined.slice(this.SALT_LENGTH + this.IV_LENGTH);
    
    const key = await this.deriveKey(password, salt);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: this.ALGO, iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  }

  /**
   * Hash password with PBKDF2 + SHA-512 (for verification)
   */
  async hashPassword(password) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const derived = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 600000,
        hash: 'SHA-512'
      },
      keyMaterial,
      512
    );
    
    const hash = btoa(String.fromCharCode(...new Uint8Array(derived)));
    const saltB64 = btoa(String.fromCharCode(...salt));
    return `${saltB64}:${hash}`;
  }

  /**
   * Verify password against stored hash
   */
  async verifyPassword(password, storedHash) {
    const [saltB64, hashB64] = storedHash.split(':');
    const salt = new Uint8Array(atob(saltB64).split('').map(c => c.charCodeAt(0)));
    
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const derived = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 600000,
        hash: 'SHA-512'
      },
      keyMaterial,
      512
    );
    
    const computedHash = btoa(String.fromCharCode(...new Uint8Array(derived)));
    return computedHash === hashB64;
  }

  /**
   * Generate secure random bytes as hex
   */
  secureRandomBytes(length = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
}
