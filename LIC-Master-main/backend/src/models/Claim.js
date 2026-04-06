const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema(
  {
    policyNumber: { type: String, required: true },
    policyholderName: { type: String, required: true },
    claimType: { type: String, required: true },
    reason: { type: String, required: true },
    /** Legacy claims may still have plain string filenames (no file on disk). */
    documents: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending',
    },
    remarks: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Claim', claimSchema);

