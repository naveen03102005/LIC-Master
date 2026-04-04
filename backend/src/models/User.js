const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    policyNumber: { type: String, required: true, unique: true },
    mobileNumber: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);

