// Encryption utilities for sensitive data
const crypto = require('crypto');

// Ensure we have an encryption key
const ENCRYPTION_KEY = process.env.KEY_SECRET?.slice(0, 32); // 32 bytes key for AES-256
const IV = Buffer.alloc(16, 0); // Initialization Vector

if (!ENCRYPTION_KEY) {
  throw new Error("Encryption key is missing. Set KEY_SECRET in your environment.");
}

// Encrypt text using AES-256-CBC
const encrypt = (text) => {
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, IV);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

// Decrypt text using AES-256-CBC
const decrypt = (encrypted) => {
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, IV);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

// Hash text using SHA-256 (for PINs)
const hashPin = (pin) => {
  return crypto.createHash('sha256').update(pin).digest('hex');
};

// Generate a random merchant code
const generateMerchantCode = (businessName) => {
  // Extract first letters from business name words
  const initials = businessName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3); // Get up to 3 letters
  
  // Add random numbers
  const randomNumbers = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  
  return initials + randomNumbers;
};

// Validate Ethereum address
const isValidEthereumAddress = (address) => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

module.exports = {
  encrypt,
  decrypt,
  hashPin,
  generateMerchantCode,
  isValidEthereumAddress
};