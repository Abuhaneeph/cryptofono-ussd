// Wallet operations module
const { 
  generatePrivateKey,
  privateKeyToAccount
} = require('viem/accounts');
const { createPublicClient, http } = require('viem');
const { base, baseSepolia } = require('viem/chains');
const { createPimlicoClient } = require('permissionless/clients/pimlico');
const { entryPoint07Address } = require('viem/account-abstraction');
const { createSmartAccountClient } = require('permissionless');
const { toSafeSmartAccount } = require('permissionless/accounts');
const { parseAbi, getAddress, maxUint256 } = require('viem');

const db = require('../config/database');
const { encrypt, decrypt } = require('../utils/crypto');

// Network configuration
const NETWORK = process.env.NETWORK || 'testnet'; // Default to testnet if not specified

// Chain and endpoint configuration based on network
const getChainConfig = () => {
  if (NETWORK === 'mainnet') {
    return {
      chain: base,
      rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      pimlicoUrl: `https://api.pimlico.io/v2/${base.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Mainnet USDC address on Base
    };
  } else {
    return {
      chain: baseSepolia,
      rpcUrl: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      pimlicoUrl: `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${process.env.PIMLICO_API_KEY}`,
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // Testnet USDC address
    };
  }
};

// Get current network configuration
const config = getChainConfig();

// USDC token address based on the current network
const USDC_ADDRESS = config.usdcAddress;

// Create or get a smart wallet for a user
async function getOrCreateSmartWallet(phoneNumber) {
  try {
    const privateKeyColumn = `${NETWORK}_private_key_encrypted`;
    const walletAddressColumn = `${NETWORK}_wallet_address`;
    
    // Check if user exists and has a wallet for the current network
    const [users] = await db.query(
      `SELECT id, ${walletAddressColumn} as wallet_address, ${privateKeyColumn} as private_key_encrypted 
       FROM users WHERE phone_number = ?`,
      [phoneNumber]
    );
    
    if (users.length > 0 && users[0].wallet_address && users[0].private_key_encrypted) {
      // User exists and has a wallet for this network
      const privateKey = decrypt(users[0].private_key_encrypted);
      const walletData = await setupSmartWallet(privateKey);
      return walletData;
    } else if (users.length > 0) {
      // User exists but doesn't have a wallet for this network
      const privateKey = generatePrivateKey();
      const encryptedKey = encrypt(privateKey);
      const walletData = await setupSmartWallet(privateKey);
      
      // Update user with wallet information for the current network
      await db.query(
        `UPDATE users SET ${walletAddressColumn} = ?, ${privateKeyColumn} = ? WHERE phone_number = ?`,
        [walletData.account.address, encryptedKey, phoneNumber]
      );
      
      return walletData;
    }
    
    throw new Error('User not found');
  } catch (error) {
    console.error(`Error getting or creating ${NETWORK} smart wallet:`, error);
    throw error;
  }
}

// Set up a smart wallet with the provided private key
async function setupSmartWallet(privateKey) {
  // Get network configuration
  const networkConfig = getChainConfig();
  
  // Create public client
  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  // Create Pimlico client
  const apiKey = process.env.PIMLICO_API_KEY;
  const pimlicoClient = createPimlicoClient({
    chain: networkConfig.chain,
    transport: http(networkConfig.pimlicoUrl),
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
    chain: networkConfig.chain,
    bundlerTransport: http(networkConfig.pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });

  console.log(`Smart wallet setup complete for address: ${account.address} on ${NETWORK}`);
  
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
    console.error(`Error checking USDC balance on ${NETWORK}:`, error);
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
    console.error(`Error checking native balance on ${NETWORK}:`, error);
    return 0;
  }
}

// Send USDC to address
async function sendUSDC(senderPhoneNumber, recipientAddress, amount) {
  try {
    console.log(`Sending ${amount} USDC from ${senderPhoneNumber} to ${recipientAddress} on ${NETWORK}`);
    
    // Get the sender's wallet for the current network
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
        message: `Insufficient USDC balance on ${NETWORK}. You have ${usdcBalance.toFixed(6)} USDC. Need at least ${parseFloat(amount) + 1} USDC (including fees).`
      };
    }
    
    // Get current network configuration
    const networkConfig = getChainConfig();
    
    // Setup Pimlico client for USDC as gas token
    const apiKey = process.env.PIMLICO_API_KEY;
    
    const pimlicoClient = createPimlicoClient({
      chain: networkConfig.chain,
      transport: http(networkConfig.pimlicoUrl),
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
      chain: networkConfig.chain,
      bundlerTransport: http(networkConfig.pimlicoUrl),
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
    
    // Get block explorer URL based on network
    const explorerUrl = NETWORK === 'mainnet' 
      ? `https://basescan.org/tx/${hash}`
      : `https://sepolia.basescan.org/tx/${hash}`;
    
    console.log(`Transaction hash: ${explorerUrl}`);
    
    // Get sender ID to record transaction
    const [senderResult] = await db.query(
      'SELECT id FROM users WHERE phone_number = ?',
      [senderPhoneNumber]
    );
    
    if (senderResult.length > 0) {
      const senderId = senderResult[0].id;
      
      // Record transaction with network information
      await db.query(
        'INSERT INTO transactions (sender_id, recipient_address, amount, transaction_type, tx_hash, status, network) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [senderId, recipientAddress, parseFloat(amount), 'send', hash, 'completed', NETWORK]
      );
    }
    
    return {
      success: true,
      message: `Successfully sent ${amount} USDC to ${recipientAddress} on ${NETWORK}`,
      txHash: hash
    };
  } catch (error) {
    console.error(`Error sending USDC on ${NETWORK}:`, error);
    return {
      success: false,
      message: `Failed to send USDC on ${NETWORK}: ${error.message}`
    };
  }
}

// Pay a merchant using merchant code
async function payMerchant(customerPhoneNumber, merchantCode, amount) {
  try {
    // Validate merchant code and get their wallet for the current network
    const walletAddressColumn = `${NETWORK}_wallet_address`;
    
    const [merchantResult] = await db.query(
      `SELECT id, phone_number, ${walletAddressColumn} as wallet_address 
       FROM users WHERE merchant_code = ? AND account_type = ?`,
      [merchantCode, 'merchant']
    );
    
    if (merchantResult.length === 0) {
      return {
        success: false,
        message: 'Invalid merchant code. Please check and try again.'
      };
    }
    
    // Check if merchant has a wallet for the current network
    if (!merchantResult[0].wallet_address) {
      try {
        // Create merchant wallet for this network if it doesn't exist
        await getOrCreateSmartWallet(merchantResult[0].phone_number);
        
        // Fetch the newly created wallet address
        const [updatedMerchant] = await db.query(
          `SELECT ${walletAddressColumn} as wallet_address 
           FROM users WHERE merchant_code = ? AND account_type = ?`,
          [merchantCode, 'merchant']
        );
        
        if (!updatedMerchant[0].wallet_address) {
          return {
            success: false,
            message: `Merchant does not have a wallet set up for ${NETWORK}. Please try again later.`
          };
        }
        
        merchantResult[0].wallet_address = updatedMerchant[0].wallet_address;
      } catch (walletError) {
        return {
          success: false,
          message: `Merchant does not have a wallet set up for ${NETWORK}. Please try again later.`
        };
      }
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
        
        // Record merchant payment with network information
        await db.query(
          'INSERT INTO merchant_payments (merchant_id, customer_id, amount, tx_hash, status, network) VALUES (?, ?, ?, ?, ?, ?)',
          [merchantId, customerId, parseFloat(amount), result.txHash, 'completed', NETWORK]
        );
      }
    }
    
    return result;
  } catch (error) {
    console.error(`Error paying merchant on ${NETWORK}:`, error);
    return {
      success: false,
      message: `Failed to pay merchant on ${NETWORK}: ${error.message}`
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
    
    // Get transactions where user is sender or recipient for the current network
    const [transactions] = await db.query(
      `SELECT 
        t.*,
        CASE 
          WHEN t.sender_id = ? THEN 'sent'
          WHEN t.recipient_id = ? THEN 'received'
        END as direction
      FROM transactions t
      WHERE (t.sender_id = ? OR t.recipient_id = ?) AND t.network = ?
      ORDER BY t.created_at DESC
      LIMIT ?`,
      [userId, userId, userId, userId, NETWORK, limit]
    );
    
    return transactions;
  } catch (error) {
    console.error(`Error getting recent transactions for ${NETWORK}:`, error);
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
    
    // Get merchant payments for the current network
    const [payments] = await db.query(
      `SELECT mp.*, u.phone_number as customer_phone
      FROM merchant_payments mp
      JOIN users u ON mp.customer_id = u.id
      WHERE mp.merchant_id = ? AND mp.network = ?
      ORDER BY mp.created_at DESC
      LIMIT ?`,
      [merchantId, NETWORK, limit]
    );
    
    return payments;
  } catch (error) {
    console.error(`Error getting merchant payments for ${NETWORK}:`, error);
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
    
    // Get merchant withdrawals for the current network
    const [withdrawals] = await db.query(
      `SELECT t.* 
      FROM transactions t
      WHERE t.sender_id = ? AND t.transaction_type = 'withdraw' AND t.network = ?
      ORDER BY t.created_at DESC
      LIMIT ?`,
      [merchantId, NETWORK, limit]
    );
    
    return withdrawals;
  } catch (error) {
    console.error(`Error getting merchant withdrawals for ${NETWORK}:`, error);
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