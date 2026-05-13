// Simple build script for Chrome Extension
import fs from 'fs';
import path from 'path';

const SRC_DIR = 'src';
const DIST_DIR = 'dist';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean and rebuild
console.log('🔨 Building Secure Wallet Extension...');
fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// Copy manifest
fs.copyFileSync('manifest.json', path.join(DIST_DIR, 'manifest.json'));

// Copy source files
copyDir(SRC_DIR, path.join(DIST_DIR, SRC_DIR));

// Copy icons placeholder (would be real PNGs)
fs.mkdirSync(path.join(DIST_DIR, 'icons'), { recursive: true });

console.log('✅ Build complete: dist/');
console.log('📦 Load dist/ folder in chrome://extensions/ (Developer mode)');
