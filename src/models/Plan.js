const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a plan name'],
      unique: true,
      enum: ['Free', 'Student', 'Lawyer', 'Court'],
    },
    description: {
      type: String,
      required: [true, 'Please add a description'],
    },
    priceMonthly: {
      type: Number,
      required: [true, 'Please add a monthly price'],
      default: 0,
    },
    priceAnnual: {
      type: Number,
      required: [true, 'Please add an annual price'],
      default: 0,
    },
    features: {
      type: [String],
      required: [true, 'Please add features'],
    },
    recommended: {
      type: Boolean,
      default: false,
    },
    dailyViewLimit: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Plan', PlanSchema);
