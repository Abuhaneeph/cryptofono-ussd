// User management module
const db = require('../config/database');
const { hashPin, generateMerchantCode } = require('../utils/crypto');
const walletService = require('./wallet');

// Network configuration
const NETWORK = process.env.NETWORK || 'testnet'; // Default to testnet if not specified

// Check if a user exists by phone number
async function checkUserExists(phoneNumber) {
  try {
    const [users] = await db.query(
      'SELECT * FROM users WHERE phone_number = ?',
      [phoneNumber]
    );
    
    return users.length > 0;
  } catch (error) {
    console.error('Error checking user existence:', error);
    return false;
  }
}

// Get user details by phone number
async function getUserByPhone(phoneNumber) {
  try {
    const [users] = await db.query(
      `SELECT 
        id, 
        phone_number, 
        account_type, 
        ${NETWORK}_wallet_address AS wallet_address, 
        business_name, 
        merchant_code 
      FROM users 
      WHERE phone_number = ?`,
      [phoneNumber]
    );
    
    return users.length > 0 ? users[0] : null;
  } catch (error) {
    console.error('Error getting user by phone:', error);
    return null;
  }
}

// Validate user PIN
async function validatePin(phoneNumber, pin) {
  try {
    const hashedPin = hashPin(pin);
    
    const [users] = await db.query(
      'SELECT id FROM users WHERE phone_number = ? AND pin = ?',
      [phoneNumber, hashedPin]
    );
    
    return users.length > 0;
  } catch (error) {
    console.error('Error validating PIN:', error);
    return false;
  }
}

// Register a new regular user
async function registerRegularUser(phoneNumber, pin) {
  try {
    // Check if user already exists
    const userExists = await checkUserExists(phoneNumber);
    
    if (userExists) {
      return {
        success: false,
        message: 'Phone number already registered. Please login.'
      };
    }
    
    // Hash the PIN
    const hashedPin = hashPin(pin);
    
    // Create user in database
    const [result] = await db.query(
      'INSERT INTO users (phone_number, account_type, pin) VALUES (?, ?, ?)',
      [phoneNumber, 'regular', hashedPin]
    );
    
    // Generate wallet for the current network
    try {
      await walletService.getOrCreateSmartWallet(phoneNumber);
    } catch (walletError) {
      console.error(`Error creating ${NETWORK} wallet during registration:`, walletError);
      // Continue despite wallet creation error, wallet will be created later
    }
    
    return {
      success: true,
      message: `Registration successful! Your ${NETWORK} USDC wallet is ready.`
    };
  } catch (error) {
    console.error('Error registering regular user:', error);
    return {
      success: false,
      message: 'Registration failed. Please try again later.'
    };
  }
}

// Register a new merchant
async function registerMerchant(phoneNumber, pin, businessName) {
  try {
    // Check if user already exists
    const userExists = await checkUserExists(phoneNumber);
    
    if (userExists) {
      return {
        success: false,
        message: 'Phone number already registered. Please login.'
      };
    }
    
    // Hash the PIN
    const hashedPin = hashPin(pin);
    
    // Generate merchant code
    const merchantCode = generateMerchantCode(businessName);
    
    // Create merchant in database
    const [result] = await db.query(
      'INSERT INTO users (phone_number, account_type, pin, business_name, merchant_code) VALUES (?, ?, ?, ?, ?)',
      [phoneNumber, 'merchant', hashedPin, businessName, merchantCode]
    );
    
    // Generate wallet for the current network
    try {
      await walletService.getOrCreateSmartWallet(phoneNumber);
    } catch (walletError) {
      console.error(`Error creating ${NETWORK} wallet during merchant registration:`, walletError);
      // Continue despite wallet creation error, wallet will be created later
    }
    
    return {
      success: true,
      message: `Registration successful! Your Merchant Code is: ${merchantCode}`,
      merchantCode
    };
  } catch (error) {
    console.error('Error registering merchant:', error);
    return {
      success: false,
      message: 'Registration failed. Please try again later.'
    };
  }
}

// Get merchant information by merchant code
async function getMerchantByCode(merchantCode) {
  try {
    const [merchants] = await db.query(
      `SELECT 
        id, 
        phone_number, 
        business_name, 
        ${NETWORK}_wallet_address AS wallet_address 
      FROM users 
      WHERE merchant_code = ? AND account_type = ?`,
      [merchantCode, 'merchant']
    );
    
    return merchants.length > 0 ? merchants[0] : null;
  } catch (error) {
    console.error('Error getting merchant by code:', error);
    return null;
  }
}

async function getWalletAddress(phoneNumber) {
  try {
    const walletAddressColumn = `${NETWORK}_wallet_address`;
    
    const [users] = await db.query(
      `SELECT ${walletAddressColumn} AS wallet_address FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );
    
    if (users.length === 0 || !users[0].wallet_address) {
      // If no wallet address is stored for the current network, try to create one
      const walletData = await walletService.getOrCreateSmartWallet(phoneNumber);
      
      // Update user with new wallet address if it was just created
      if (walletData && walletData.account && walletData.account.address) {
        await db.query(
          `UPDATE users SET ${walletAddressColumn} = ? WHERE phone_number = ?`,
          [walletData.account.address, phoneNumber]
        );
        
        return walletData.account.address;
      }
      
      return null;
    }
    
    return users[0].wallet_address;
  } catch (error) {
    console.error(`Error getting ${NETWORK} wallet address:`, error);
    return null;
  }
}

module.exports = {
  checkUserExists,
  getUserByPhone,
  validatePin,
  registerRegularUser,
  registerMerchant,
  getMerchantByCode,
  getWalletAddress
};