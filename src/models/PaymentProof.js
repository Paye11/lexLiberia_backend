const mongoose = require('mongoose');

const PaymentProofSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'annual'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    image: {
      type: Buffer,
      required: true,
      select: false,
    },
    imageType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
    },
    approvedBillingCycle: {
      type: String,
      enum: ['monthly', 'annual'],
    },
    reviewNote: {
      type: String,
      default: '',
    },
    reviewedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

PaymentProofSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentProof', PaymentProofSchema);
