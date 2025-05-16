# CryptoFono

<div align="center">
 
  <p><strong>Cryptocurrency for Everyone on Base - No Smartphone Required</strong></p>
</div>

## 📱 Overview

CryptoFono enables feature phone users to access cryptocurrency services through USSD, making digital assets accessible to the unbanked and those without smartphones or internet access. Send, receive, and manage USDC stablecoins on Base blockchain with just a basic phone.

## 🔗 API Endpoints

### Base URLs
* **Testnet Environment**: `https://cryptofono-ussd-testnet.onrender.com/ussd`
* **Mainnet Environment**: `https://cryptofono-ussd.onrender.com/ussd`

### Documentation
* **Postman API Documentation**: [CryptoFono USSD API](https://www.postman.com/security-architect-92214193/cryptofono/collection/ue8u9wt/cryptofono-ussd-api?action=share&creator=45016156)

## 🎥 Demo
Watch our demonstration video: [CryptoFono Demo](https://youtu.be/_7N1VA6spXA)

## ✨ Features

### User Account Types
- **Regular User Accounts**: For individuals to send and receive cryptocurrency
- **Merchant Accounts**: For businesses to accept payments and manage transactions

### User Authentication
- PIN-based security (4-digit PIN)
- Session management
- Secure registration flow

### Regular User Features
1. **Account Management**
   - New user registration
   - PIN creation and authentication
   - Balance checking

2. **Transactions**
   - Send USDC to other CryptoFono users
   - Send USDC to external Ethereum wallets
   - Pay merchants using merchant codes
   - View transaction history

3. **Wallet Management**
   - View wallet address
   - Check USDC balance

### Merchant Features
1. **Business Management**
   - Merchant registration with business name
   - Unique merchant code generation for receiving payments

2. **Financial Operations**
   - Check balance
   - View received payments with customer details
   - Withdraw funds to CryptoFono users or external wallets
   - View withdrawal history

3. **Merchant Tools**
   - Share merchant code with customers
   - View wallet address for direct deposits

## 🖥️ Technical Implementation

### USSD Menu Structure
CryptoFono uses a multi-level USSD menu system:
- **Level 1**: Authentication (PIN entry) or registration selection
- **Level 2**: Main menu options
- **Level 3+**: Feature-specific submenus and transaction flows

### Technology Stack
- **Backend**: Node.js
- **Database**: MySQL (Aiven managed database)
- **Blockchain Integration**: 
  - **Network**: Base Mainnet (production) / Base Sepolia (testnet)
  - Pimlico for ERC-4337 account abstraction
  - Alchemy for blockchain API access
  - USDC stablecoin for transactions

### Security Features
- PIN-based authentication
- Phone number verification
- Transaction confirmations
- Masked phone numbers for privacy

### Transaction Flow
1. Select recipient (CryptoFono user, merchant, or external wallet)
2. Enter amount
3. Review and confirm
4. Receive confirmation or error message

## 🔧 Installation and Setup

### Prerequisites
- Node.js
- MySQL database (we use Aiven Cloud for production)
- Pimlico API key for smart wallet functionality
- Alchemy API key for blockchain interactions

### Configuration
1. Clone the repository
2. Install dependencies with `npm install`
3. Configure environment variables in a `.env` file:
   ```
   # Application configuration
   PORT=3000
   DB_PORT=your_db_port
   DB_HOST=your_database_host
   DB_USER=your_database_user
   DB_PASS=your_database_password
   DB_NAME=your_database_name
   PIMLICO_API_KEY=your_pimlico_api_key
   KEY_SECRET=your_key_secret
   ALCHEMY_API_KEY=your_alchemy_api_key

   # Network configuration
   # Options: 'mainnet' (Base Mainnet) or 'testnet' (Base Sepolia)
   NETWORK=testnet
   ```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
