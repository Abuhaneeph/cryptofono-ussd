// Complete implementation with the USDC send functionality
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const crypto = require('crypto');
const { 
  generatePrivateKey,
  privateKeyToAccount
} = require('viem/accounts');
const { createPublicClient, http } = require('viem');
const { baseSepolia } = require('viem/chains');
const { createPimlicoClient } = require('permissionless/clients/pimlico');
const { entryPoint07Address } = require('viem/account-abstraction');
const { createSmartAccountClient } = require('permissionless');
const { toSafeSmartAccount } = require('permissionless/accounts');
const { parseAbi, getAddress, maxUint256 } = require('viem');

// Import the database module
const db = require('./config/database');

// USDC token address
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// AES-256-CBC encryption/decryption for sensitive data
const ENCRYPTION_KEY = process.env.KEY_SECRET?.slice(0, 32); // 32 bytes key for AES-256
const IV = Buffer.alloc(16, 0); // Initialization Vector

if (!ENCRYPTION_KEY) {
  throw new Error("Encryption key is missing. Set KEY_SECRET in your environment.");
}

// Encryption functions
const encrypt = (text) => {
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, IV);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

const decrypt = (encrypted) => {
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, IV);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

// Function to validate Ethereum address
function isValidEthereumAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Smart wallet functions
async function getOrCreateSmartWallet(phoneNumber) {
  try {
    // Check if user exists and has a wallet
    const [users] = await db.query(
      'SELECT wallet_address, private_key_encrypted FROM users WHERE phone_number = ?',
      [phoneNumber]
    );
    
    if (users.length > 0 && users[0].wallet_address && users[0].private_key_encrypted) {
      // User exists and has a wallet
      const privateKey = decrypt(users[0].private_key_encrypted);
      const walletData = await setupSmartWallet(privateKey);
      return walletData;
    } else if (users.length > 0) {
      // User exists but doesn't have a wallet
      const privateKey = generatePrivateKey();
      const encryptedKey = encrypt(privateKey);
      const walletData = await setupSmartWallet(privateKey);
      
      // Update user with wallet information
      await db.query(
        'UPDATE users SET wallet_address = ?, private_key_encrypted = ? WHERE phone_number = ?',
        [walletData.account.address, encryptedKey, phoneNumber]
      );
      
      return walletData;
    }
    
    throw new Error('User not found');
  } catch (error) {
    console.error('Error getting or creating smart wallet:', error);
    throw error;
  }
}

async function setupSmartWallet(privateKey) {
  // Create public client
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
  });

  // Create Pimlico client
  const apiKey = process.env.PIMLICO_API_KEY;
  const pimlicoUrl = `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${apiKey}`;
  
  const pimlicoClient = createPimlicoClient({
    chain: baseSepolia,
    transport: http(pimlicoUrl),
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  // Create Safe smart account
  const account = await toSafeSmartAccount({
    client: publicClient,
    owners: [privateKeyToAccount(privateKey)],
    version: "1.4.1",
  });

  // Create smart account client
  const smartAccountClient = createSmartAccountClient({
    account,
    chain: baseSepolia,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });

  // 🔑 Send a test transaction to activate the wallet
  console.log("\nSending a test transaction to activate the wallet...");
  const txHash = await smartAccountClient.sendTransaction({
    to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", // Example recipient
    value: 0n, // No value transfer
    data: "0x1234", // Arbitrary data to make it a valid tx
  });
  console.log(`✅ User operation included: https://sepolia.basescan.org/tx/${txHash}`);

  return {
    account,
    smartAccountClient,
    publicClient,
    privateKey,
  };
}

// Check token balance
async function checkUSDCBalance(walletAddress, publicClient) {
  try {
    const balance = await publicClient.readContract({
      abi: parseAbi(["function balanceOf(address account) returns (uint256)"]),
      address: USDC_ADDRESS,
      functionName: "balanceOf",
      args: [walletAddress],
    });
    
    return Number(balance) / 1_000_000; // Convert to human-readable format (6 decimals for USDC)
  } catch (error) {
    console.error('Error checking USDC balance:', error);
    return 0;
  }
}

// Check native token balance
async function checkNativeBalance(walletAddress, publicClient) {
  try {
    const balance = await publicClient.getBalance({
      address: walletAddress,
    });
    
    return Number(balance) / 1e18; // Convert to ETH units
  } catch (error) {
    console.error('Error checking native balance:', error);
    return 0;
  }
}

// Send USDC function
// Send USDC function
async function sendUSDC(senderPhoneNumber, recipientAddress, amount) {
  try {
    console.log(`Sending ${amount} USDC from ${senderPhoneNumber} to ${recipientAddress}`);
    
    // Get the sender's wallet
    const walletData = await getOrCreateSmartWallet(senderPhoneNumber);
    
    // Check USDC balance
    const usdcBalance = await checkUSDCBalance(walletData.account.address, walletData.publicClient);
    
    // Convert amount to USDC units (6 decimals)
    const amountInUsdcUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000));
    console.log('amount', amountInUsdcUnits);
   
    // Ensure we have at least 1 USDC (since we need some for fees as well)
    if (usdcBalance < parseFloat(amount) + 1) {
      return {
        success: false,
        message: `Insufficient USDC balance. You have ${usdcBalance.toFixed(6)} USDC. Need at least ${parseFloat(amount) + 1} USDC (including fees).`
      };
    }
    
    // Setup Pimlico client for USDC as gas token
    const apiKey = process.env.PIMLICO_API_KEY;
    const pimlicoUrl = `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${apiKey}`;
    
    const pimlicoClient = createPimlicoClient({
      chain: baseSepolia,
      transport: http(pimlicoUrl),
      entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
      },
    });
    
    // Get token quotes to use USDC as gas token
    const quotes = await pimlicoClient.getTokenQuotes({
      tokens: [USDC_ADDRESS]
    });
    
    if (!quotes || quotes.length === 0) {
      throw new Error("Failed to get token quotes for USDC");
    }
    
    const paymaster = quotes[0].paymaster;
    
    // CRITICAL FIX: Use the privateKey from walletData directly, not attempting to decrypt it again
    // The privateKey should already be decrypted in the walletData object from getOrCreateSmartWallet
    const privateKey = walletData.privateKey;
    const owner = privateKeyToAccount(privateKey);
    
    // Create the account with the owner
    const account = await toSafeSmartAccount({
      client: walletData.publicClient,
      owners: [owner],
      version: "1.4.1",
    });
    
    // Create smart account client with USDC as gas token
    const smartAccountClient = createSmartAccountClient({
      account,
      chain: baseSepolia,
      bundlerTransport: http(pimlicoUrl),
      paymaster: pimlicoClient,
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });
    
    // Send the transaction with multiple calls (approve + transfer)
    const hash = await smartAccountClient.sendTransaction({
      calls: [
        {
          // First approve the paymaster to spend USDC
          to: getAddress(USDC_ADDRESS),
          abi: parseAbi(["function approve(address,uint256)"]),
          functionName: "approve",
          args: [paymaster, maxUint256],
        },
        {
          // Then transfer USDC to recipient
          to: getAddress(USDC_ADDRESS),
          abi: parseAbi(["function transfer(address to, uint256 amount)"]),
          functionName: "transfer",
          args: [recipientAddress, amountInUsdcUnits],
        },
      ],
      paymasterContext: {
        token: USDC_ADDRESS,
      },
    });
    
    console.log(`Transaction hash: https://sepolia.basescan.org/tx/${hash}`);
    
    return {
      success: true,
      message: `Successfully sent ${amount} USDC to ${recipientAddress}`,
      txHash: hash
    };
  } catch (error) {
    console.error('Error sending USDC:', error);
    return {
      success: false,
      message: `Failed to send USDC: ${error.message}`
    };
  }
}

// Initialize Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// USSD endpoint
app.post('/ussd', async (req, res) => {
  try {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;
    console.log(`USSD request from ${phoneNumber}: ${text}`);
    
    let response = '';
    const textArray = text.split('*');
    const level = textArray.length;
    const lastInput = textArray[textArray.length - 1];
    
    // First level - Main menu
    if (text === '') {
      response = `CON Welcome to Smart Wallet USSD
1. Register
2. Login`;
    } 
    // Registration flow
    else if (text === '1') {
      response = 'CON Enter a password for your wallet:';
    }
    else if (level === 2 && textArray[0] === '1') {
      const password = lastInput;
      
      if (password.length < 6) {
        response = 'END Password is too short. Please try again with at least 6 characters.';
      } else {
        try {
          // Check if user already exists
          const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE phone_number = ?',
            [phoneNumber]
          );
          
          if (existingUsers.length > 0) {
            response = 'END User already registered. Please login.';
          } else {
            try {
              // Create new user
              const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
              
              const [userResult] = await db.query(
                'INSERT INTO users (phone_number, password) VALUES (?, ?)',
                [phoneNumber, hashedPassword]
              );
              
              // Create wallet
              const privateKey = generatePrivateKey();
              const walletData = await setupSmartWallet(privateKey);
              const encryptedKey = encrypt(privateKey);
              
              await db.query(
                'UPDATE users SET wallet_address = ?, private_key_encrypted = ? WHERE phone_number = ?',
                [walletData.account.address, encryptedKey, phoneNumber]
              );
              
              response = `END Registration successful! Your wallet is ready.
Address: ${walletData.account.address.slice(0, 10)}...${walletData.account.address.slice(-8)}`;
            } catch (error) {
              console.error('Registration error:', error);
              response = 'END Registration failed. Please try again later.';
            } 
          }
        } catch (error) {
          console.error('Registration error:', error);
          response = 'END Registration failed. Please try again later.';
        }
      }
    }
    // Login flow
    else if (text === '2') {
      response = 'CON Enter your password:';
    }
    else if (level === 2 && textArray[0] === '2') {
      const password = lastInput;
      
      try {
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        
        const [users] = await db.query(
          'SELECT id FROM users WHERE phone_number = ? AND password = ?',
          [phoneNumber, hashedPassword]
        );
        
        if (users.length > 0) {
          response = `CON Welcome back!
1. Account Info
2. Send USDC
3. Exit`;
        } else {
          response = 'END Invalid password or user not registered.';
        }
      } catch (error) {
        console.error('Login error:', error);
        response = 'END Login failed. Please try again later.';
      }
    }
    // Account Info menu
    else if (level === 3 && textArray[0] === '2' && textArray[2] === '1') {
      response = `CON Account Information:
1. Wallet Address
2. Native Balance
3. USDC Balance
4. Back`;
    }
    // Wallet Address
    else if (level === 4 && textArray[0] === '2' && textArray[2] === '1' && textArray[3] === '1') {
      try {
        const walletData = await getOrCreateSmartWallet(phoneNumber);
        const address = walletData.account.address;
        response = `END Your wallet address: 
${address}`;
      } catch (error) {
        console.error('Error fetching wallet address:', error);
        response = 'END Could not retrieve wallet address. Please try again later.';
      }
    }
    // Native Balance
    else if (level === 4 && textArray[0] === '2' && textArray[2] === '1' && textArray[3] === '2') {
      try {
        const walletData = await getOrCreateSmartWallet(phoneNumber);
        const balance = await checkNativeBalance(walletData.account.address, walletData.publicClient);
        response = `END Native Balance: ${balance.toFixed(6)} ETH`;
      } catch (error) {
        console.error('Error checking native balance:', error);
        response = 'END Could not retrieve native balance. Please try again later.';
      }
    }
    // USDC Balance
    else if (level === 4 && textArray[0] === '2' && textArray[2] === '1' && textArray[3] === '3') {
      try {
        const walletData = await getOrCreateSmartWallet(phoneNumber);
        const balance = await checkUSDCBalance(walletData.account.address, walletData.publicClient);
        response = `END USDC Balance: ${balance.toFixed(6)} USDC`;
      } catch (error) {
        console.error('Error checking USDC balance:', error);
        response = 'END Could not retrieve USDC balance. Please try again later.';
      }
    }
    // Back to main menu after login
    else if (level === 4 && textArray[0] === '2' && textArray[2] === '1' && textArray[3] === '4') {
      response = `CON Welcome back!
1. Account Info
2. Send USDC
3. Exit`;
    }
    // Send USDC flow
    else if (level === 3 && textArray[0] === '2' && textArray[2] === '2') {
      response = 'CON Enter recipient address:';
    }
    // Recipient address entered
    else if (level === 4 && textArray[0] === '2' && textArray[2] === '2') {
      const recipientAddress = lastInput;
      
      if (!isValidEthereumAddress(recipientAddress)) {
        response = 'END Invalid Ethereum address. Please try again.';
      } else {
        response = 'CON Enter amount of USDC to send:';
      }
    }
    // Amount entered
    else if (level === 5 && textArray[0] === '2' && textArray[2] === '2') {
      const recipientAddress = textArray[3];
      const amount = parseFloat(lastInput);
      
      if (isNaN(amount) || amount <= 0) {
        response = 'END Invalid amount. Please try again with a positive number.';
      } else {
        response = `CON Send ${amount} USDC to:
${recipientAddress}

1. Confirm
2. Cancel`;
      }
    }
    // Confirmation
    else if (level === 6 && textArray[0] === '2' && textArray[2] === '2') {
      const recipientAddress = textArray[3];
      const amount = textArray[4];
      const confirmation = lastInput;
      
      if (confirmation === '1') {
        try {
          // Send USDC
          const result = await sendUSDC(phoneNumber, recipientAddress, amount);
          
          if (result.success) {
            response = `END ${result.message}
Transaction Hash: ${result.txHash}`;
          } else {
            response = `END ${result.message}`;
          }
        } catch (error) {
          console.error('Error in USDC transfer:', error);
          response = 'END Failed to send USDC. Please try again later.';
        }
      } else if (confirmation === '2') {
        response = 'END Transaction cancelled.';
      } else {
        response = 'END Invalid option. Transaction cancelled.';
      }
    }
    // Exit
    else if (level === 3 && textArray[0] === '2' && textArray[2] === '3') {
      response = 'END Thank you for using Smart Wallet USSD. Goodbye!';
    }
    // Default case for invalid inputs
    else {
      response = 'END Invalid option. Please try again.';
    }
    
    res.set('Content-Type', 'text/plain');
    res.send(response);
    
  } catch (error) {
    console.error('USSD processing error:', error);
    res.set('Content-Type', 'text/plain');
    res.send('END An error occurred. Please try again later.');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
});