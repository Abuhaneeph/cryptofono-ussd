// Core USSD handler for Cryptofono
const userService = require('../services/user');
const walletService = require('../services/wallet');
const { isValidEthereumAddress } = require('../utils/crypto');
const db = require('../config/database');

/**
 * Handle USSD requests
 * @param {Object} params - USSD request parameters
 * @param {string} params.sessionId - Session ID
 * @param {string} params.serviceCode - Service code
 * @param {string} params.phoneNumber - User phone number
 * @param {string} params.text - USSD input text
 * @returns {string} USSD response
 */
async function handleUssdRequest(params) {
  const { sessionId, serviceCode, phoneNumber, text } = params;
  console.log(`USSD request from ${phoneNumber}: ${text}`);
  
  try {
    // Parse input
    const textArray = text.split('*');
    const level = textArray.length;
    const lastInput = textArray[textArray.length - 1];
    
    // Handle initial state - Show welcome menu
    if (text === '') {
      // Check if user exists to decide between login or registration
      const userExists = await userService.checkUserExists(phoneNumber);
      
      if (userExists) {
        // User exists - Show login menu
        return 'CON Welcome back to Cryptofono 💸\nEnter your 4-digit PIN:';
      } else {
        // User doesn't exist - Show registration menu
        return 'CON Welcome to Cryptofono 💸\nLet\'s create your account!\nChoose Account Type:\n1. Regular User\n2. Merchant';
      }
    }
    
    // Registration flow for new users
    if (!await userService.checkUserExists(phoneNumber)) {
      return await handleRegistrationFlow(phoneNumber, textArray, lastInput);
    }
    
    // Login flow for existing users
    return await handleLoginFlow(phoneNumber, textArray, lastInput);
    
  } catch (error) {
    console.error('Error in USSD handler:', error);
    return 'END An error occurred. Please try again later.';
  }
}

/**
 * Handle registration flow for new users
 */
async function handleRegistrationFlow(phoneNumber, textArray, lastInput) {
  const level = textArray.length;
  
  // First level - Account type selection
  if (level === 1) {
    const accountType = lastInput;
    
    if (accountType === '1') {
      // Regular user PIN creation
      return 'CON Create 4-digit PIN:';
    } else if (accountType === '2') {
      // Merchant PIN creation
      return 'CON Create 4-digit PIN:';
    } else {
      return 'END Invalid option. Please try again.';
    }
  }
  
  // Second level - PIN creation
  else if (level === 2) {
    const accountType = textArray[0];
    const pin = lastInput;
    
    // Validate PIN
    if (!/^\d{4}$/.test(pin)) {
      return 'END PIN must be exactly 4 digits. Please try again.';
    }
    
    if (accountType === '1') {
      // Regular user - PIN confirmation
      return `CON Confirm PIN:`;
    } else if (accountType === '2') {
      // Merchant - PIN confirmation
      return `CON Confirm PIN:`;
    }
  }
  
  // Third level - PIN confirmation
  else if (level === 3) {
    const accountType = textArray[0];
    const pin = textArray[1];
    const confirmPin = lastInput;
    
    if (pin !== confirmPin) {
      return 'END PINs do not match. Please try again.';
    }
    
    if (accountType === '1') {
      // Regular user - Complete registration
      const result = await userService.registerRegularUser(phoneNumber, pin);
      return `CON ${result.message}\n\n1. Continue to menu`;
    } else if (accountType === '2') {
      // Merchant - Enter business name
      return 'CON Enter Business Name:';
    }
  }
  
  // Fourth level - Business name (merchants only) or Continue to menu (regular users)
  else if (level === 4) {
    const accountType = textArray[0];
    
    if (accountType === '1' && lastInput === '1') {
      // User selected "Continue to menu" after registration
      const user = await userService.getUserByPhone(phoneNumber);
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    } else if (accountType === '2') {
      const pin = textArray[1];
      const businessName = lastInput;
      
      if (!businessName || businessName.trim() === '') {
        return 'END Business name cannot be empty. Please try again.';
      }
      
      // Register merchant
      const result = await userService.registerMerchant(phoneNumber, pin, businessName);
      
      if (result.success) {
        return `CON ${result.message}\n\n1. Continue to menu`;
      } else {
        return `END ${result.message}`;
      }
    }
  }
  
  // Fifth level - Continue to menu (merchants)
  else if (level === 5 && textArray[0] === '2' && lastInput === '1') {
    return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. Exit';
  }
  
  return 'END Invalid option. Please try again.';
}

/**
 * Handle login flow for existing users
 */
async function handleLoginFlow(phoneNumber, textArray, lastInput) {
  const level = textArray.length;
  
  // First level - PIN verification
  if (level === 1) {
    const pin = lastInput;
    
    // Validate PIN
    if (!/^\d{4}$/.test(pin)) {
      return 'END PIN must be 4 digits. Please try again.';
    }
    
    const isValid = await userService.validatePin(phoneNumber, pin);
    
    if (!isValid) {
      return 'END Invalid PIN. Please try again.';
    }
    
    // Get user details to determine account type
    const user = await userService.getUserByPhone(phoneNumber);
    
    if (!user) {
      return 'END User not found. Please try again.';
    }
    
    // Show appropriate menu based on account type
    if (user.account_type === 'regular') {
      return 'CON Login successful!\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    } else if (user.account_type === 'merchant') {
      return 'CON Login successful!\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. Exit';
    } else {
      return 'END Unknown account type. Please contact support.';
    }
  }
  
  // Post-login menu for authenticated users
  if (level >= 2) {
    // Get user to determine account type
    const user = await userService.getUserByPhone(phoneNumber);
    
    if (!user) {
      return 'END User not found. Please try again.';
    }
    
    if (user.account_type === 'regular') {
      return await handleRegularUserMenu(phoneNumber, textArray, lastInput, user);
    } else if (user.account_type === 'merchant') {
      return await handleMerchantMenu(phoneNumber, textArray, lastInput, user);
    }
  }
  
  return 'END Invalid option. Please try again.';
}

/**
 * Handle menu options for regular users
 */
/**
 * Handle menu options for regular users
 */
async function handleRegularUserMenu(phoneNumber, textArray, lastInput, user) {
  // Second level menu selection
  if (textArray.length === 2) {
    const option = textArray[1];
    
    // Check Balance
    if (option === '1') {
      try {
        const walletData = await walletService.getOrCreateSmartWallet(phoneNumber);
        const usdcBalance = await walletService.checkUSDCBalance(walletData.account.address, walletData.publicClient);
        
        return `CON Your USDC Balance: ${usdcBalance.toFixed(6)} USDC\n\n0. Back to Main Menu\n9. Exit`;
      } catch (error) {
        console.error('Error checking balance:', error);
        return 'CON Could not retrieve balance. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // Send USDC - Modified to provide options
    else if (option === '2') {
      return 'CON Send USDC to:\n1. Cryptofono User\n2. External Wallet Address\n\n0. Back to Main Menu';
    }
    
    // Pay a Merchant
    else if (option === '3') {
      return 'CON Enter merchant code:\n\n0. Back to Main Menu';
    }
    
    // View Transactions
    else if (option === '4') {
      try {
        const transactions = await walletService.getRecentTransactions(phoneNumber);
        
        if (transactions.length === 0) {
          return 'CON No recent transactions found.\n\n0. Back to Main Menu\n9. Exit';
        }
        
        let response = 'CON Recent Transactions:';
        transactions.forEach((tx, index) => {
          const direction = tx.direction;
          const amount = Number(tx.amount).toFixed(2);
          const date = new Date(tx.created_at).toLocaleDateString();
          
          response += `\n${index + 1}. ${direction === 'sent' ? 'Sent' : 'Received'} ${amount} USDC - ${date}`;
        });
        
        response += '\n\n0. Back to Main Menu\n9. Exit';
        return response;
      } catch (error) {
        console.error('Error retrieving transactions:', error);
        return 'CON Could not retrieve transactions. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // My Wallet Address
    else if (option === '5') {
      try {
        const walletData = await walletService.getOrCreateSmartWallet(phoneNumber);
        const walletAddress = walletData.account.address;
        
        return `CON Your Wallet Address:\n${walletAddress}\n\n0. Back to Main Menu\n9. Exit`;
      } catch (error) {
        console.error('Error retrieving wallet address:', error);
        return 'CON Could not retrieve wallet address. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // Exit
    else if (option === '6' || option === '9') {
      return 'END Thank you for using Cryptofono. Goodbye!';
    }
    
    // Back to Main Menu
    else if (option === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
  }
  
  // For Send USDC flow - Choose recipient type
  else if (textArray.length === 3 && textArray[1] === '2') {
    const recipientType = lastInput;
    
    // Back to Main Menu
    if (recipientType === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    // Send to Cryptofono User
    else if (recipientType === '1') {
      return 'CON Enter recipient phone number:\n\n0. Back to Main Menu';
    }
    
    // Send to External Wallet
    else if (recipientType === '2') {
      return 'CON Enter recipient address:\n\n0. Back to Main Menu';
    }
    
    else {
      return 'CON Invalid option. Please try again.\n\n0. Back to Main Menu';
    }
  }
  
  // Navigation options for level 3 responses (View Balance, Transactions, Wallet Address)
  else if (textArray.length === 3 && (textArray[1] === '1' || textArray[1] === '4' || textArray[1] === '5')) {
    const menuOption = textArray[1];
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    // Exit
    else if (navigationOption === '9') {
      return 'END Thank you for using Cryptofono. Goodbye!';
    }
  }
  
  // For Send USDC flow - Enter phone number for Cryptofono user
  else if (textArray.length === 4 && textArray[1] === '2' && textArray[2] === '1') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    const recipientPhone = lastInput;
    
    // Validate phone number and check if user exists
    const recipientUser = await userService.getUserByPhone(recipientPhone);
    
    if (!recipientUser) {
      return 'CON Cryptofono user not found. Please check number and try again.\n\n0. Back to Main Menu';
    }
    
    return 'CON Enter amount to send (USDC):\n\n0. Back to Main Menu';
  }
  
  // For Send USDC flow to external wallet - Enter address
  else if (textArray.length === 4 && textArray[1] === '2' && textArray[2] === '2') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    const recipientAddress = lastInput;
    
    if (!isValidEthereumAddress(recipientAddress)) {
      return 'CON Invalid Ethereum address. Please try again.\n\n0. Back to Main Menu';
    }
    
    return 'CON Enter amount to send (USDC):\n\n0. Back to Main Menu';
  }
  
  // Pay a Merchant flow - Enter merchant code
  else if (textArray.length === 3 && textArray[1] === '3') {
    const merchantCode = lastInput;
    
    // Back to Main Menu
    if (merchantCode === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    // Validate merchant code
    const merchant = await userService.getMerchantByCode(merchantCode);
    
    if (!merchant) {
      return 'CON Invalid merchant code. Please check and try again.\n\n0. Back to Main Menu';
    }
    
    return `CON Pay to: ${merchant.business_name}\nEnter amount (USDC):\n\n0. Back to Main Menu`;
  }
  
  // For Send USDC flow to Cryptofono user - Enter amount
  else if (textArray.length === 5 && textArray[1] === '2' && textArray[2] === '1') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    const recipientPhone = textArray[3];
    const amount = parseFloat(lastInput);
    
    if (isNaN(amount) || amount <= 0) {
      return 'CON Invalid amount. Please enter a positive number.\n\n0. Back to Main Menu';
    }
    
    // Get recipient user details for confirmation
    const recipientUser = await userService.getUserByPhone(recipientPhone);
    
    // Show masked phone number for privacy
    const maskedPhone = '*'.repeat(recipientPhone.length - 4) + recipientPhone.slice(-4);
    
    return `CON Send ${amount} USDC to Cryptofono user ${maskedPhone}?\n\n1. Confirm\n2. Cancel\n0. Back to Main Menu`;
  }
  
  // For Send USDC flow to external wallet - Enter amount
  else if (textArray.length === 5 && textArray[1] === '2' && textArray[2] === '2') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    const recipientAddress = textArray[3];
    const amount = parseFloat(lastInput);
    
    if (isNaN(amount) || amount <= 0) {
      return 'CON Invalid amount. Please enter a positive number.\n\n0. Back to Main Menu';
    }
    
    return `CON Send ${amount} USDC to external address:\n${recipientAddress}\n\n1. Confirm\n2. Cancel\n0. Back to Main Menu`;
  }
  
  // Pay a Merchant flow - Enter amount
  else if (textArray.length === 4 && textArray[1] === '3') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    }
    
    const merchantCode = textArray[2];
    const amount = parseFloat(lastInput);
    
    if (isNaN(amount) || amount <= 0) {
      return 'CON Invalid amount. Please enter a positive number.\n\n0. Back to Main Menu';
    }
    
    // Get merchant details for confirmation
    const merchant = await userService.getMerchantByCode(merchantCode);
    
    return `CON Pay ${amount} USDC to ${merchant.business_name}?\n\n1. Confirm\n2. Cancel\n0. Back to Main Menu`;
  }
  
  // For Send USDC flow to Cryptofono user - Confirmation
  else if (textArray.length === 6 && textArray[1] === '2' && textArray[2] === '1') {
    const recipientPhone = textArray[3];
    const amount = textArray[4];
    const confirmation = lastInput;
    
    if (confirmation === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    } else if (confirmation === '1') {
      try {
        // Get recipient user details and wallet address
        const recipientUser = await userService.getUserByPhone(recipientPhone);
        
        if (!recipientUser || !recipientUser.wallet_address) {
          return 'CON Recipient wallet not found. Transaction cancelled.\n\n0. Back to Main Menu\n9. Exit';
        }
        
        // Send USDC to the recipient's wallet address
        const result = await walletService.sendUSDC(phoneNumber, recipientUser.wallet_address, amount);
        
        if (result.success) {
          // Update transaction record to include recipient_id for proper tracking
          const [senderResult] = await db.query(
            'SELECT id FROM users WHERE phone_number = ?',
            [phoneNumber]
          );
          
          const [recipientResult] = await db.query(
            'SELECT id FROM users WHERE phone_number = ?',
            [recipientPhone]
          );
          
          if (senderResult.length > 0 && recipientResult.length > 0) {
            // Update the transaction to include recipient_id
            await db.query(
              'UPDATE transactions SET recipient_id = ? WHERE tx_hash = ?',
              [recipientResult[0].id, result.txHash]
            );
          }
          
          // Show masked phone number for privacy
          const maskedPhone = '*'.repeat(recipientPhone.length - 4) + recipientPhone.slice(-4);
          return `CON Successfully sent ${amount} USDC to Cryptofono user ${maskedPhone}\n\n0. Back to Main Menu\n9. Exit`;
        } else {
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        }
      } catch (error) {
        console.error('Error sending USDC to Cryptofono user:', error);
        return 'CON Failed to send USDC. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    } else if (confirmation === '2') {
      return 'CON Transaction cancelled.\n\n0. Back to Main Menu\n9. Exit';
    } else {
      return 'CON Invalid option. Transaction cancelled.\n\n0. Back to Main Menu\n9. Exit';
    }
  }
  
  // For Send USDC flow to external wallet - Confirmation
  else if (textArray.length === 6 && textArray[1] === '2' && textArray[2] === '2') {
    const recipientAddress = textArray[3];
    const amount = textArray[4];
    const confirmation = lastInput;
    
    if (confirmation === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    } else if (confirmation === '1') {
      try {
        const result = await walletService.sendUSDC(phoneNumber, recipientAddress, amount);
        
        if (result.success) {
          // Set transaction_type to 'external_send' for better tracking
          if (result.txHash) {
            await db.query(
              'UPDATE transactions SET transaction_type = ? WHERE tx_hash = ?',
              ['external_send', result.txHash]
            );
          }
          
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        } else {
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        }
      } catch (error) {
        console.error('Error sending USDC to external wallet:', error);
        return 'CON Failed to send USDC. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    } else if (confirmation === '2') {
      return 'CON Transaction cancelled.\n\n0. Back to Main Menu\n9. Exit';
    } else {
      return 'CON Invalid option. Transaction cancelled.\n\n0. Back to Main Menu\n9. Exit';
    }
  }
  
  // Pay a Merchant flow - Confirmation
  else if (textArray.length === 5 && textArray[1] === '3') {
    const merchantCode = textArray[2];
    const amount = textArray[3];
    const confirmation = lastInput;
    
    if (confirmation === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. Send USDC\n3. Pay a Merchant\n4. View Transactions\n5. My Wallet Address\n6. Exit';
    } else if (confirmation === '1') {
      try {
        const result = await walletService.payMerchant(phoneNumber, merchantCode, amount);
        
        if (result.success) {
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        } else {
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        }
      } catch (error) {
        console.error('Error paying merchant:', error);
        return 'CON Failed to pay merchant. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    } else if (confirmation === '2') {
      return 'CON Payment cancelled.\n\n0. Back to Main Menu\n9. Exit';
    } else {
      return 'CON Invalid option. Payment cancelled.\n\n0. Back to Main Menu\n9. Exit';
    }
  }
  
  // Default response for any other navigation or invalid options
  return 'CON Invalid option. Please try again.\n\n0. Back to Main Menu\n9. Exit';
}

/**
 * Handle menu options for merchant users
 */
async function handleMerchantMenu(phoneNumber, textArray, lastInput, user) {
  // Second level menu selection
  if (textArray.length === 2) {
    const option = textArray[1];
    
    // Check Balance
    if (option === '1') {
      try {
        const walletData = await walletService.getOrCreateSmartWallet(phoneNumber);
        const usdcBalance = await walletService.checkUSDCBalance(walletData.account.address, walletData.publicClient);
        
        return `CON Your USDC Balance: ${usdcBalance.toFixed(6)} USDC\n\n0. Back to Main Menu\n9. Exit`;
      } catch (error) {
        console.error('Error checking balance:', error);
        return 'CON Could not retrieve balance. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // View Payments
    else if (option === '2') {
      try {
        const payments = await walletService.getMerchantPayments(phoneNumber);
        
        if (payments.length === 0) {
          return 'CON No recent payments found.\n\n0. Back to Main Menu\n9. Exit';
        }
        
        let response = 'CON Recent Payments:';
        payments.forEach((payment, index) => {
          const amount = Number(payment.amount).toFixed(2);  // Ensure it's treated as a number
          const date = new Date(payment.created_at).toLocaleDateString();
          const phone = payment.customer_phone.slice(-4); // Show last 4 digits
          
          response += `\n${index + 1}. Received ${amount} USDC from ***${phone} - ${date}`;
        });
        
        response += '\n\n0. Back to Main Menu\n9. Exit';
        return response;
      } catch (error) {
        console.error('Error retrieving payments:', error);
        return 'CON Could not retrieve payments. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // Withdraw
    else if (option === '3') {
      return 'CON Withdraw to:\n1. Cryptofono User\n2. External Wallet Address\n\n0. Back to Main Menu';
    }
    
    // Share Merchant Code
    else if (option === '4') {
      return `CON Your Merchant Code is: ${user.merchant_code}\n\nShare this code with customers for payments.\n\n0. Back to Main Menu\n9. Exit`;
    }
    
    // My Wallet Address
    else if (option === '5') {
      try {
        const walletData = await walletService.getOrCreateSmartWallet(phoneNumber);
        const walletAddress = walletData.account.address;
        
        return `CON Your Wallet Address:\n${walletAddress}\n\n0. Back to Main Menu\n9. Exit`;
      } catch (error) {
        console.error('Error retrieving wallet address:', error);
        return 'CON Could not retrieve wallet address. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // View Withdrawals
    else if (option === '6') {
      try {
        const withdrawals = await walletService.getMerchantWithdrawals(phoneNumber);
        
        if (withdrawals.length === 0) {
          return 'CON No withdrawal history found.\n\n0. Back to Main Menu\n9. Exit';
        }
        
        let response = 'CON Recent Withdrawals:';
        withdrawals.forEach((withdrawal, index) => {
          const amount = Number(withdrawal.amount).toFixed(2);
          const date = new Date(withdrawal.created_at).toLocaleDateString();
          const shortAddress = `${withdrawal.recipient_address.substring(0, 6)}...${withdrawal.recipient_address.substring(38)}`;
          
          response += `\n${index + 1}. Sent ${amount} USDC to ${shortAddress} - ${date}`;
        });
        
        response += '\n\n0. Back to Main Menu\n9. Exit';
        return response;
      } catch (error) {
        console.error('Error retrieving withdrawals:', error);
        return 'CON Could not retrieve withdrawal history. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    }
    
    // Exit
    else if (option === '7' || option === '9') {
      return 'END Thank you for using Cryptofono. Goodbye!';
    }
    
    // Back to Main Menu
    else if (option === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    }
  }
  
  // Navigation options
  if (textArray.length === 3) {
    const menuOption = textArray[1];
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    }
    
    // Exit
    else if (navigationOption === '9') {
      return 'END Thank you for using Cryptofono. Goodbye!';
    }
    
    // For Withdraw flow - Choose recipient type
    else if (menuOption === '3') {
      const recipientType = lastInput;
      
      // Withdraw to Cryptofono User
      if (recipientType === '1') {
        return 'CON Enter recipient phone number:\n\n0. Back to Main Menu';
      }
      
      // Withdraw to External Wallet
      else if (recipientType === '2') {
        return 'CON Enter withdrawal address:\n\n0. Back to Main Menu';
      }
      
      else {
        return 'CON Invalid option. Please try again.\n\n0. Back to Main Menu';
      }
    }
  }
  
  // For Withdraw flow - Enter phone number for Cryptofono user
  else if (textArray.length === 4 && textArray[1] === '3' && textArray[2] === '1') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    }
    
    const recipientPhone = lastInput;
    
    // Validate phone number and check if user exists
    const recipientUser = await userService.getUserByPhone(recipientPhone);
    
    if (!recipientUser) {
      return 'CON Cryptofono user not found. Please check number and try again.\n\n0. Back to Main Menu';
    }
    
    return 'CON Enter amount to withdraw (USDC):\n\n0. Back to Main Menu';
  }
  
  // For Withdraw flow to external wallet - Enter address
  else if (textArray.length === 4 && textArray[1] === '3' && textArray[2] === '2') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    }
    
    const withdrawalAddress = lastInput;
    
    if (!isValidEthereumAddress(withdrawalAddress)) {
      return 'CON Invalid Ethereum address. Please try again.\n\n0. Back to Main Menu';
    }
    
    return 'CON Enter amount to withdraw (USDC):\n\n0. Back to Main Menu';
  }
  
  // For Withdraw flow to Cryptofono user - Enter amount
  else if (textArray.length === 5 && textArray[1] === '3' && textArray[2] === '1') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    }
    
    const recipientPhone = textArray[3];
    const amount = parseFloat(lastInput);
    
    if (isNaN(amount) || amount <= 0) {
      return 'CON Invalid amount. Please enter a positive number.\n\n0. Back to Main Menu';
    }
    
    // Get recipient user details for confirmation
    const recipientUser = await userService.getUserByPhone(recipientPhone);
    
    // Show masked phone number for privacy
    const maskedPhone = '*'.repeat(recipientPhone.length - 4) + recipientPhone.slice(-4);
    
    return `CON Withdraw ${amount} USDC to Cryptofono user ${maskedPhone}?\n\n1. Confirm\n2. Cancel\n0. Back to Main Menu`;
  }
  
  // For Withdraw flow to external wallet - Enter amount
  else if (textArray.length === 5 && textArray[1] === '3' && textArray[2] === '2') {
    const navigationOption = lastInput;
    
    // Back to Main Menu
    if (navigationOption === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    }
    
    const withdrawalAddress = textArray[3];
    const amount = parseFloat(lastInput);
    
    if (isNaN(amount) || amount <= 0) {
      return 'CON Invalid amount. Please enter a positive number.\n\n0. Back to Main Menu';
    }
    
    return `CON Withdraw ${amount} USDC to:\n${withdrawalAddress}\n\n1. Confirm\n2. Cancel\n0. Back to Main Menu`;
  }
  
  // For Withdraw flow to Cryptofono user - Confirmation
  else if (textArray.length === 6 && textArray[1] === '3' && textArray[2] === '1') {
    const recipientPhone = textArray[3];
    const amount = textArray[4];
    const confirmation = lastInput;
    
    if (confirmation === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    } else if (confirmation === '1') {
      try {
        // Get recipient user details and wallet address
        const recipientUser = await userService.getUserByPhone(recipientPhone);
        
        if (!recipientUser || !recipientUser.wallet_address) {
          return 'CON Recipient wallet not found. Transaction cancelled.\n\n0. Back to Main Menu\n9. Exit';
        }
        
        // Send USDC to the recipient's wallet address
        const result = await walletService.sendUSDC(phoneNumber, recipientUser.wallet_address, amount);
        
        if (result.success) {
          // Update transaction record to include recipient_id for proper tracking
          const [senderResult] = await db.query(
            'SELECT id FROM users WHERE phone_number = ?',
            [phoneNumber]
          );
          
          const [recipientResult] = await db.query(
            'SELECT id FROM users WHERE phone_number = ?',
            [recipientPhone]
          );
          
          if (senderResult.length > 0 && recipientResult.length > 0) {
            // Update the transaction to include recipient_id
            await db.query(
              'UPDATE transactions SET recipient_id = ? WHERE tx_hash = ?',
              [recipientResult[0].id, result.txHash]
            );
          }
          
          // Update transaction type to 'withdraw'
          await db.query(
            'UPDATE transactions SET transaction_type = ? WHERE tx_hash = ?',
            ['withdraw', result.txHash]
          );
          
          // Show masked phone number for privacy
          const maskedPhone = '*'.repeat(recipientPhone.length - 4) + recipientPhone.slice(-4);
          return `CON Successfully sent ${amount} USDC to Cryptofono user ${maskedPhone}\n\n0. Back to Main Menu\n9. Exit`;
        } else {
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        }
      } catch (error) {
        console.error('Error withdrawing USDC to Cryptofono user:', error);
        return 'CON Failed to withdraw USDC. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    } else if (confirmation === '2') {
      return 'CON Withdrawal cancelled.\n\n0. Back to Main Menu\n9. Exit';
    } else {
      return 'CON Invalid option. Withdrawal cancelled.\n\n0. Back to Main Menu\n9. Exit';
    }
  }
  
  // For Withdraw flow to external wallet - Confirmation
  else if (textArray.length === 6 && textArray[1] === '3' && textArray[2] === '2') {
    const withdrawalAddress = textArray[3];
    const amount = textArray[4];
    const confirmation = lastInput;
    
    if (confirmation === '0') {
      return 'CON Main Menu:\n1. Check Balance\n2. View Payments\n3. Withdraw\n4. Share Merchant Code\n5. My Wallet Address\n6. View Withdrawals\n7. Exit';
    } else if (confirmation === '1') {
      try {
        const result = await walletService.sendUSDC(phoneNumber, withdrawalAddress, amount);
        
        if (result.success) {
          // Update transaction type to 'withdraw'
          await db.query(
            'UPDATE transactions SET transaction_type = ? WHERE tx_hash = ?',
            ['withdraw', result.txHash]
          );
          
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        } else {
          return `CON ${result.message}\n\n0. Back to Main Menu\n9. Exit`;
        }
      } catch (error) {
        console.error('Error withdrawing USDC to external wallet:', error);
        return 'CON Failed to withdraw USDC. Please try again later.\n\n0. Back to Main Menu\n9. Exit';
      }
    } else if (confirmation === '2') {
      return 'CON Withdrawal cancelled.\n\n0. Back to Main Menu\n9. Exit';
    } else {
      return 'CON Invalid option. Withdrawal cancelled.\n\n0. Back to Main Menu\n9. Exit';
    }
  }
  
  return 'CON Invalid option. Please try again.\n\n0. Back to Main Menu\n9. Exit';
}

module.exports = {
  handleUssdRequest
};