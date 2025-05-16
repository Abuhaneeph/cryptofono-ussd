// Main application entry point
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

// Import database connection
const db = require('./config/database');

// Import USSD handler
const { handleUssdRequest } = require('./handlers/ussd');

// Log network configuration on startup
console.log(`Starting application in ${process.env.NETWORK || 'testnet'} mode`);

// Initialize Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Home route
app.get('/', (req, res) => {
  res.send('Cryptofono USSD Service is running');
});

// USSD endpoint
app.post('/ussd', async (req, res) => {
  try {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;
    
    // Log incoming request
    console.log(`Received USSD request: `, {
      sessionId,
      serviceCode,
      phoneNumber,
      text
    });
    
    // Process USSD request
    const response = await handleUssdRequest({
      sessionId,
      serviceCode,
      phoneNumber,
      text
    });
    
    // Set response content type and send
    res.set('Content-Type', 'text/plain');
    res.send(response);
    
  } catch (error) {
    console.error('Error processing USSD request:', error);
    
    // Send error response
    res.set('Content-Type', 'text/plain');
    res.send('END An error occurred. Please try again later.');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Cryptofono USSD service running on port ${PORT}`);
  
});