# Cryptofono USSD Service

A mobile-accessible cryptocurrency platform that works over USSD, allowing users to access digital financial services through basic feature phones without requiring internet connectivity or smartphones.

## 🌍 Problem Statement

In many regions across Africa, Latin America, and parts of Asia:
- Internet connectivity is unreliable or expensive
- Smartphone adoption is still growing
- Traditional financial infrastructure is limited
- Many remain unbanked or underbanked
- Cryptocurrency adoption faces accessibility barriers

Cryptofono solves these problems by enabling cryptocurrency transactions over the USSD protocol - the same technology used for mobile airtime top-ups and basic mobile banking, making digital financial services accessible to anyone with even the most basic feature phone.

## ✨ Features

- **Universal Access**: Works on any mobile phone, no internet or smartphone required
- **User Registration**: Simple onboarding for both regular users and merchants
- **Smart Wallet Creation**: Automatic blockchain wallet creation using account abstraction
- **USDC Transactions**: Send, receive, and store USDC stablecoins
- **Multiple Transfer Options**: Send to other Cryptofono users or external Ethereum addresses
- **Merchant Payments**: Pay businesses directly using their unique merchant codes
- **Transaction History**: View payment history and recent transactions
- **Simple Interface**: Access all cryptocurrency features through an intuitive USSD menu

## 🏗️ Project Structure

```
cryptofono-ussd/
├── app.js                  # Main application entry point
├── config/
│   └── database.js         # Database configuration
├── handlers/
│   └── ussd.js             # USSD request handler
├── services/
│   ├── user.js             # User management operations
│   └── wallet.js           # Blockchain wallet operations
├── utils/
│   └── crypto.js           # Encryption and security utilities
└── README.md               # Project documentation
```

## 🚀 Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/cryptofono-ussd.git
cd cryptofono-ussd
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with the following variables:
```
# Database Configuration
DB_HOST=localhost
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=cryptofono

# Blockchain Configuration
RPC_URL=your_ethereum_rpc_url
USDC_CONTRACT_ADDRESS=0x...
ENTRYPOINT_ADDRESS=0x...
FACTORY_ADDRESS=0x...

# Security
PIN_ENCRYPTION_KEY=your_encryption_key

# Pimlico API (for gas sponsorship)
PIMLICO_API_KEY=your_pimlico_api_key
```

4. Set up the database schema:
```bash
mysql -u your_database_user -p your_database_name < schema.sql
```

5. Start the server:
```bash
npm start
```

## 📝 USSD Flow

### New User Registration
1. Dial service code (e.g., *123#)
2. Select account type:
   - 1: Regular User
   - 2: Merchant
3. Create a 4-digit PIN
4. Confirm PIN
5. Merchants only: Enter business name
6. Account is created with an Ethereum wallet

### Login & Authentication
1. Dial service code (e.g., *123#)
2. Enter 4-digit PIN
3. Access main menu based on account type

### Regular User Menu
1. Check Balance
2. Send USDC
   - To Cryptofono user (via phone number)
   - To external wallet address
3. Pay a Merchant (via merchant code)
4. View Transactions
5. My Wallet Address
6. Exit

### Merchant Menu
1. Check Balance
2. View Payments
3. Withdraw
   - To Cryptofono user
   - To external wallet address
4. Share Merchant Code
5. My Wallet Address
6. View Withdrawals
7. Exit

## 🧪 Testing with Postman

You can test the USSD service using Postman by simulating USSD requests:

1. Open Postman and create a new POST request
2. Use the URL: `http://your-server-address/api/ussd`
3. Set the request body to `x-www-form-urlencoded`
4. Add the following parameters:
   - `sessionId`: A random string (e.g., "SESS123456789")
   - `serviceCode`: "*123#" (or your configured service code)
   - `phoneNumber`: A valid phone number (e.g., "+254712345678")
   - `text`: Leave empty for initial request, then use the response history for subsequent requests

Example Initial Request:
```
POST /api/ussd
Content-Type: application/x-www-form-urlencoded

sessionId=SESS123456789&serviceCode=*123#&phoneNumber=+254712345678&text=
```

For subsequent requests, update the `text` parameter based on your navigation through the menu. For example, to select "1" from the main menu, set `text=1`. To navigate deeper, use `*` as separators, e.g., `text=1*1234` for selecting option 1 and then entering PIN 1234.

## 🛠️ Technologies Used

- **Node.js & Express**: Backend server framework
- **MySQL**: Database for user data and transaction records
- **Viem**: Ethereum interaction library
- **Permissionless**: Account abstraction library for smart contract wallets
- **Pimlico**: Gas sponsorship for gasless transactions
- **Africa's Talking/Twilio**: USSD service provider integration

## 💡 How It Works

1. **Wallet Creation**: Each user gets an ERC-4337 compliant smart contract wallet upon registration
2. **Transaction Flow**:
   - User initiates transaction via USSD
   - Backend creates and signs the transaction
   - Gas fees are sponsored through Pimlico's paymaster
   - Transaction is bundled and sent to the blockchain
   - Result is communicated back to the user via USSD
3. **Gasless Experience**: Users don't need ETH for gas fees
4. **Security**: All transactions require PIN authentication

## 🔗 Blockchain Integration

Cryptofono uses account abstraction (ERC-4337) to provide a seamless user experience:

- **Smart Contract Wallets**: Each user gets a smart wallet that can handle token transactions
- **Sponsored Transactions**: Users don't pay gas fees
- **Simplified UX**: No need to understand blockchain concepts to use the service
- **USDC Support**: All transactions use USDC stablecoin

## 🔜 Roadmap

- Multi-token support for other stablecoins
- Integration with local payment methods
- P2P marketplace for goods and services
- Savings and group contribution features
- Merchant APIs for advanced integrations

## 📄 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.