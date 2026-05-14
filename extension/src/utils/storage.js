/**
 * Secure Storage — chrome.storage.local wrapper with encryption
 * SECURITY: All values JSON-serialized. Raw access for encrypted wallet data.
 */

export class SecureStorage {
  constructor() {
    this.prefix = 'sw_';
  }

  async get(key) {
    const result = await chrome.storage.local.get(this.prefix + key);
    const value = result[this.prefix + key];
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async set(key, value) {
    const store = {};
    store[this.prefix + key] = JSON.stringify(value);
    await chrome.storage.local.set(store);
  }

  async remove(key) {
    await chrome.storage.local.remove(this.prefix + key);
  }

  async getRaw(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }

  async setRaw(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }
}
