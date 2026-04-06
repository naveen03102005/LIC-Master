const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Claim = require('../models/Claim');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

const uploadDir = path.join(__dirname, '../../uploads/claims');

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const base = (file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}`);
  },
});

const upload = multer({ storage });

// Create new claim
router.post('/', authMiddleware, upload.array('documents'), async (req, res) => {
  try {
    const { policyNumber, policyholderName, claimType, reason } = req.body;

    if (!policyNumber || !policyholderName || !claimType || !reason) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const documents = (req.files || []).map((file) => ({
      originalName: file.originalname,
      storedPath: path.join('claims', file.filename).replace(/\\/g, '/'),
    }));

    const claim = await Claim.create({
      policyNumber,
      policyholderName,
      claimType,
      reason,
      documents,
    });

    res.status(201).json({ message: 'Claim submitted successfully', claim });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit claim' });
  }
});

// Get claims for a policyholder
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { policyNumber } = req.query;
    const query = policyNumber ? { policyNumber } : {};
    const claims = await Claim.find(query).sort({ createdAt: -1 });
    res.json(claims);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch claims' });
  }
});

// Get claim by ID (for status tracking)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    res.json(claim);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch claim' });
  }
});

module.exports = router;
