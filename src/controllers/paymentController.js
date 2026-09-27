const Payment = require('../models/Payment');

exports.createPayment = (req, res) => {
  res.status(400).json({
    success: false,
    message: 'Send the plan amount to the Lonestar number on the pricing page, then upload the screenshot. An admin confirms it before the plan opens.',
  });
};

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
