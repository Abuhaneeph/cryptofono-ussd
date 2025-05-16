// Wallet operations module
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

const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/crypto');

// USDC token address
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Create or get a smart wallet for a user
async function getOrCreateSmartWallet(phoneNumber) {
  try {
    // Check if user exists and has a wallet
    const [users] = await db.query(
      'SELECT id, wallet_address, private_key_encrypted FROM users WHERE phone_number = ?',
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

// Set up a smart wallet with the provided private key
async function setupSmartWallet(privateKey) {
  // Create public client
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(`https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`),
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

  console.log(`Smart wallet setup complete for address: ${account.address}`);
  
  return {
    account,
    smartAccountClient,
    publicClient,
    privateKey,
  };
}

// Check USDC balance
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

// Send USDC to address
async function sendUSDC(senderPhoneNumber, recipientAddress, amount) {
  try {
    console.log(`Sending ${amount} USDC from ${senderPhoneNumber} to ${recipientAddress}`);
    
    // Get the sender's wallet
    const walletData = await getOrCreateSmartWallet(senderPhoneNumber);
    
    // Check USDC balance
    const usdcBalance = await checkUSDCBalance(walletData.account.address, walletData.publicClient);
    
    // Convert amount to USDC units (6 decimals)
    const amountInUsdcUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000));
    console.log('amount in USDC units:', amountInUsdcUnits);
   
    // Ensure sufficient balance (including fees)
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
    
    // Use the privateKey from walletData
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
    
    // Get sender ID to record transaction
    const [senderResult] = await db.query(
      'SELECT id FROM users WHERE phone_number = ?',
      [senderPhoneNumber]
    );
    
    if (senderResult.length > 0) {
      const senderId = senderResult[0].id;
      
      // Record transaction
      await db.query(
        'INSERT INTO transactions (sender_id, recipient_address, amount, transaction_type, tx_hash, status) VALUES (?, ?, ?, ?, ?, ?)',
        [senderId, recipientAddress, parseFloat(amount), 'send', hash, 'completed']
      );
    }
    
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

// Pay a merchant using merchant code
async function payMerchant(customerPhoneNumber, merchantCode, amount) {
  try {
    // Validate merchant code
  const [merchantResult] = await db.query(
  'SELECT id, phone_number, wallet_address FROM users WHERE merchant_code = ? AND account_type = ?',
  [merchantCode, 'merchant']
);

    
    if (merchantResult.length === 0) {
      return {
        success: false,
        message: 'Invalid merchant code. Please check and try again.'
      };
    }
    
    const merchantId = merchantResult[0].id;
    const recipientAddress = merchantResult[0].wallet_address;
    
    // Send USDC to merchant
    const result = await sendUSDC(customerPhoneNumber, recipientAddress, amount);
    
    if (result.success) {
      // Get customer ID
      const [customerResult] = await db.query(
        'SELECT id FROM users WHERE phone_number = ?',
        [customerPhoneNumber]
      );
      
      if (customerResult.length > 0) {
        const customerId = customerResult[0].id;
        
        // Record merchant payment
        await db.query(
          'INSERT INTO merchant_payments (merchant_id, customer_id, amount, tx_hash, status) VALUES (?, ?, ?, ?, ?)',
          [merchantId, customerId, parseFloat(amount), result.txHash, 'completed']
        );
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error paying merchant:', error);
    return {
      success: false,
      message: `Failed to pay merchant: ${error.message}`
    };
  }
}

// Get recent transactions for a user
async function getRecentTransactions(phoneNumber, limit = 5) {
  try {
    // Get user ID
    const [userResult] = await db.query(
      'SELECT id FROM users WHERE phone_number = ?',
      [phoneNumber]
    );
    
    if (userResult.length === 0) {
      return [];
    }
    
    const userId = userResult[0].id;
    
    // Get transactions where user is sender or recipient
    const [transactions] = await db.query(
      `SELECT 
        t.*,
        CASE 
          WHEN t.sender_id = ? THEN 'sent'
          WHEN t.recipient_id = ? THEN 'received'
        END as direction
      FROM transactions t
      WHERE t.sender_id = ? OR t.recipient_id = ?
      ORDER BY t.created_at DESC
      LIMIT ?`,
      [userId, userId, userId, userId, limit]
    );
    
    return transactions;
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    return [];
  }
}

// Get merchant payments
async function getMerchantPayments(merchantPhoneNumber, limit = 5) {
  try {
    // Get merchant ID
  const [merchantResult] = await db.query(
  'SELECT id FROM users WHERE phone_number = ? AND account_type = ?',
  [merchantPhoneNumber, 'merchant']
);

    
    if (merchantResult.length === 0) {
      return [];
    }
    
    const merchantId = merchantResult[0].id;
    
    // Get merchant payments
    const [payments] = await db.query(
      `SELECT mp.*, u.phone_number as customer_phone
      FROM merchant_payments mp
      JOIN users u ON mp.customer_id = u.id
      WHERE mp.merchant_id = ?
      ORDER BY mp.created_at DESC
      LIMIT ?`,
      [merchantId, limit]
    );
    
    return payments;
  } catch (error) {
    console.error('Error getting merchant payments:', error);
    return [];
  }
}

// Get merchant withdrawals
async function getMerchantWithdrawals(merchantPhoneNumber, limit = 5) {
  try {
    // Get merchant ID
    const [merchantResult] = await db.query(
      'SELECT id FROM users WHERE phone_number = ? AND account_type = ?',
      [merchantPhoneNumber, 'merchant']
    );
    
    if (merchantResult.length === 0) {
      return [];
    }
    
    const merchantId = merchantResult[0].id;
    
    // Get merchant withdrawals (transactions where merchant is sender)
    const [withdrawals] = await db.query(
      `SELECT t.* 
      FROM transactions t
      WHERE t.sender_id = ? AND t.transaction_type = 'withdraw'
      ORDER BY t.created_at DESC
      LIMIT ?`,
      [merchantId, limit]
    );
    
    return withdrawals;
  } catch (error) {
    console.error('Error getting merchant withdrawals:', error);
    return [];
  }
}

module.exports = {
  getOrCreateSmartWallet,
  setupSmartWallet,
  checkUSDCBalance,
  checkNativeBalance,
  sendUSDC,
  payMerchant,
  getRecentTransactions,
  getMerchantPayments,
  getMerchantWithdrawals
};