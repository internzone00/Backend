const express = require('express');
const PayU = require('payu-websdk');
const dotenv = require('dotenv');
const crypto = require('crypto');
const cors = require('cors');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL,
  optionsSuccessStatus: 200
}));
app.use(express.json());

// PayU Client Setup
const payuClient = new PayU({
  key: process.env.MERCHANT_KEY,
  salt: process.env.MERCHANT_SALT
}, process.env.MERCHANT_MODE);

// In-memory transaction store (for demo purposes)
const transactions = {};

// Routes
app.get('/', (req, res) => {
  res.send('PayU Gateway API');
});

app.post('/initiate-payment', async (req, res) => {
  try {
    const { txnid, amount, productinfo, firstname, email, phone, serviceDuration } = req.body;

    // Validate required fields
    if (!txnid || !amount || !productinfo || !firstname || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const paymentData = {
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      phone: phone || '',
      surl: `${process.env.BACKEND_URL}/verify/${txnid}`,
      furl: `${process.env.BACKEND_URL}/verify/${txnid}`,
      udf1: serviceDuration || '1-Month',
      udf2: "",
      udf3: "",
      udf4: "",
      udf5: ""
    };

    // Generate hash
    const hashString = [
      process.env.MERCHANT_KEY,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      paymentData.udf1,
      paymentData.udf2,
      paymentData.udf3,
      paymentData.udf4,
      paymentData.udf5,
      '', '', '', '', '', // Empty fields as per PayU docs
      process.env.MERCHANT_SALT
    ].join('|');

    paymentData.hash = crypto.createHash('sha512').update(hashString).digest('hex');

    // Initiate payment
    const response = await payuClient.paymentInitiate(paymentData);

    // Store transaction in memory (optional)
    transactions[txnid] = {
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      phone,
      serviceDuration: serviceDuration || '1-Month',
      status: 'initiated'
    };

    res.json(response);
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({ error: 'Payment initiation failed' });
  }
});

// Payment Verification Endpoint
app.all('/verify/:txnid', async (req, res) => {
  try {
    const { txnid } = req.params;
    const paymentData = req.method === 'POST' ? req.body : req.query;

    console.log('--- PayU Callback ---');
    console.log('Method:', req.method);
    console.log('Transaction ID:', txnid);
    console.log('Request Data:', paymentData);

    // Verify payment with PayU
    const verification = await payuClient.verifyPayment(txnid);
    const status = verification.transaction_details[txnid]?.status || 'failed';

    // Update transaction in memory (optional)
    if (transactions[txnid]) {
      transactions[txnid].status = status;
      transactions[txnid].verifiedAt = new Date().toISOString();
    }

    const duration = transactions[txnid]?.serviceDuration || paymentData.udf1 || '1-Month';

    // Redirect based on status
    const redirectUrl = status === 'success' 
      ? `${process.env.FRONTEND_URL}/payment-success?txnid=${txnid}&duration=${encodeURIComponent(duration)}`
      : `${process.env.FRONTEND_URL}/payment-failed?txnid=${txnid}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Verification error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/payment-error`);
  }
});

// Transaction Status Check Endpoint (Optional - Uses in-memory storage)
app.get('/transaction/:txnid', (req, res) => {
  const { txnid } = req.params;
  const transaction = transactions[txnid];
  
  if (!transaction) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  
  res.json(transaction);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});