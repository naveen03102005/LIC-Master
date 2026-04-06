const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const Claim = require('../models/Claim');
const ChatMessage = require('../models/ChatMessage');

const uploadsRoot = path.resolve(__dirname, '../../uploads');

function normalizeClaimDocumentEntry(doc, index) {
  if (typeof doc === 'string') {
    return { originalName: doc, storedPath: '' };
  }
  if (doc && typeof doc === 'object') {
    return {
      originalName: doc.originalName || `Document ${index + 1}`,
      storedPath: doc.storedPath || '',
    };
  }
  return { originalName: `Document ${index + 1}`, storedPath: '' };
}

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

// Download uploaded document for a claim (admin only)
router.get('/claims/:id/files/:index', adminAuth, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    const index = parseInt(req.params.index, 10);
    if (Number.isNaN(index) || index < 0) {
      return res.status(400).json({ message: 'Invalid file index' });
    }
    const raw = claim.documents[index];
    const { originalName, storedPath } = normalizeClaimDocumentEntry(raw, index);
    if (!storedPath) {
      return res.status(404).json({ message: 'No file stored for this document (legacy entry)' });
    }
    const absolute = path.resolve(uploadsRoot, storedPath);
    const relativeToUploads = path.relative(uploadsRoot, absolute);
    if (relativeToUploads.startsWith('..') || path.isAbsolute(relativeToUploads)) {
      return res.status(400).json({ message: 'Invalid file path' });
    }
    if (!fs.existsSync(absolute)) {
      return res.status(404).json({ message: 'File not found on server' });
    }
    res.download(absolute, originalName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to download file' });
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

