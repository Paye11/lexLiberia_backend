const Payment = require('../models/Payment');
const User = require('../models/User');
const Plan = require('../models/Plan');

// @desc    Create a payment
// @route   POST /api/payments
// @access  Private
exports.createPayment = async (req, res) => {
  try {
    const { planId, billingCycle, paymentMethod, transactionId } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found',
      });
    }

    const amount = billingCycle === 'monthly' ? plan.priceMonthly : plan.priceAnnual;

    const startDate = new Date();
    const endDate = new Date(startDate);
    if (billingCycle === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const payment = await Payment.create({
      user: req.user._id,
      plan: planId,
      amount,
      billingCycle,
      paymentMethod,
      transactionId,
      status: 'completed',
      startDate,
      endDate,
    });

    await User.findByIdAndUpdate(
      req.user._id,
      { plan: planId },
      { new: true, runValidators: true }
    );

    res.status(201).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all payments for a user
// @route   GET /api/payments
// @access  Private
exports.getPayments = async (req, res) => {
  try {
    let payments;

    if (req.user.role === 'admin') {
      payments = await Payment.find().populate('user plan');
    } else {
      payments = await Payment.find({ user: req.user._id }).populate('plan');
    }

    res.status(200).json({
      success: true,
      count: payments.length,
      data: payments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single payment
// @route   GET /api/payments/:id
// @access  Private
exports.getPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('user plan');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    if (payment.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this payment',
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
