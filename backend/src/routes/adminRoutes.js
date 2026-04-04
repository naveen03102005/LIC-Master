const express = require('express');
const jwt = require('jsonwebtoken');
const Claim = require('../models/Claim');
const ChatMessage = require('../models/ChatMessage');

const router = express.Router();

// Simple admin auth using env credentials, returns a JWT with admin role
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';

  if (username !== adminUser || password !== adminPass) {
    return res.status(401).json({ message: 'Invalid admin credentials' });
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '2h' });
  res.json({ token });
});

function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Not an admin' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// View all claims
router.get('/claims', adminAuth, async (req, res) => {
  try {
    const claims = await Claim.find().sort({ createdAt: -1 });
    res.json(claims);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch claims' });
  }
});

// Update claim status and remarks
router.put('/claims/:id', adminAuth, async (req, res) => {
  try {
    const { status, remarks } = req.body;
    const claim = await Claim.findByIdAndUpdate(
      req.params.id,
      { status, remarks },
      { new: true }
    );
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    res.json(claim);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update claim' });
  }
});

// View chatbot logs
router.get('/chatlogs', adminAuth, async (req, res) => {
  try {
    const logs = await ChatMessage.find().sort({ createdAt: -1 }).limit(200);
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch chat logs' });
  }
});

module.exports = router;

