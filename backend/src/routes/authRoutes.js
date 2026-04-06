const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// In-memory OTP store for demo purposes
const otpStore = new Map();

router.post('/request-otp', async (req, res) => {
  const { policyNumber, mobileNumber } = req.body;

  if (!policyNumber || !mobileNumber) {
    return res.status(400).json({ message: 'Policy number and mobile number are required' });
  }

  let user = await User.findOne({ policyNumber });
  if (!user) {
    user = await User.create({ policyNumber, mobileNumber });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(policyNumber, { otp, mobileNumber, expiresAt: Date.now() + 5 * 60 * 1000 });

  // In a real system, send OTP via SMS. Here we just return it for testing.
  return res.json({ message: 'OTP generated', otp });
});

router.post('/verify-otp', async (req, res) => {
  const { policyNumber, otp } = req.body;
  const record = otpStore.get(policyNumber);

  if (!record) {
    return res.status(400).json({ message: 'OTP not requested' });
  }

  if (record.expiresAt < Date.now()) {
    otpStore.delete(policyNumber);
    return res.status(400).json({ message: 'OTP expired' });
  }

  const submittedOtp = String(otp ?? '').trim();
  if (record.otp !== submittedOtp) {
    return res.status(400).json({ message: 'Invalid OTP' });
  }

  const user = await User.findOne({ policyNumber });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  otpStore.delete(policyNumber);

  const token = jwt.sign(
    { userId: user._id, policyNumber: user.policyNumber },
    process.env.JWT_SECRET || 'devsecret',
    { expiresIn: '1h' }
  );

  res.json({ token, user: { id: user._id, policyNumber: user.policyNumber, mobileNumber: user.mobileNumber } });
});

module.exports = router;

