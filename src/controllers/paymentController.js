const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Plan = require('../models/Plan');
const formatAuthUser = require('../utils/formatAuthUser');
const momo = require('../services/momo');

function sendError(res, error) {
  const status = error.statusCode || (error.name === 'MomoRequestError' ? 502 : 500);
  let message = error.message;
  if (error.name === 'MomoRequestError') {
    message = error.status === 400
      ? 'Lonestar rejected the payment details. Check the phone number and try again.'
      : 'Lonestar could not start the payment. Wait a moment and try again.';
  }

  res.status(status).json({
    success: false,
    message,
  });
}

function planAmount(plan, billingCycle) {
  return billingCycle === 'annual' ? plan.priceAnnual : plan.priceMonthly;
}

function expiryDate(billingCycle) {
  const startDate = new Date();
  const endDate = new Date(startDate);
  if (billingCycle === 'annual') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    endDate.setMonth(endDate.getMonth() + 1);
  }
  return { startDate, endDate };
}

function failureMessage(reason) {
  const text = String(reason || '').toUpperCase();
  if (text.includes('REJECT')) {
    return 'The payment was declined on the phone.';
  }
  if (text.includes('TIMEOUT') || text.includes('EXPIRED')) {
    return 'The phone did not approve the payment in time. Try again.';
  }
  return 'The payment did not go through. No plan was activated.';
}

async function applyMomoResult(payment, result) {
  const momoStatus = String(result?.status || 'PENDING').toUpperCase();

  if (momoStatus === 'PENDING' || !result?.status) {
    return Payment.findById(payment._id);
  }

  if (momoStatus === 'SUCCESSFUL') {
    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: 'pending' },
      {
        status: 'completed',
        momoFinancialId: result.financialTransactionId || '',
        failureReason: '',
      },
      { new: true }
    );

    const settled = updated || await Payment.findById(payment._id);
    if (settled?.status === 'completed') {
      await User.findByIdAndUpdate(settled.user, {
        plan: settled.plan,
        planExpiresAt: settled.endDate,
      });
    }
    return settled;
  }

  const reason = result?.reason?.message || result?.reason?.code || momoStatus;
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'pending' },
    { status: 'failed', failureReason: reason },
    { new: true }
  );

  return updated || Payment.findById(payment._id);
}

async function paymentPayload(payment, { includeUser = false } = {}) {
  const current = await Payment.findById(payment._id).populate('plan', 'name');
  let user = null;

  if (includeUser && current.status === 'completed') {
    const account = await User.findById(current.user);
    if (account) user = await formatAuthUser(account);
  }

  let message = 'Approve the payment on the Lonestar phone.';
  if (current.status === 'completed') {
    message = `${current.plan?.name || 'Your'} plan is now active.`;
  } else if (current.status === 'failed') {
    message = failureMessage(current.failureReason);
  }

  return {
    paymentId: current._id,
    status: current.status,
    message,
    amountUsd: current.amount,
    chargedAmount: current.chargedAmount,
    currency: current.currency,
    phone: current.phone,
    billingCycle: current.billingCycle,
    planName: current.plan?.name || '',
    mode: momo.isSandbox() ? 'sandbox' : 'live',
    user,
  };
}

exports.getMomoConfig = (req, res) => {
  res.status(200).json({
    success: true,
    data: momo.publicConfig(),
  });
};

exports.requestMomoPayment = async (req, res) => {
  try {
    const { planId, billingCycle, phone } = req.body;

    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        message: 'Choose a monthly or annual plan.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found',
      });
    }

    const plan = await Plan.findById(planId);
    if (!plan || plan.name === 'Free') {
      return res.status(404).json({
        success: false,
        message: 'Choose a paid plan.',
      });
    }

    const amount = planAmount(plan, billingCycle);
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'This plan is free. Create an account instead.',
      });
    }

    const charge = momo.formatCharge(amount);
    const payerPhone = momo.normalizePhone(phone);
    const referenceId = momo.newReferenceId();
    const { startDate, endDate } = expiryDate(billingCycle);

    const payment = await Payment.create({
      user: req.user._id,
      plan: plan._id,
      amount,
      currency: charge.currency,
      chargedAmount: charge.amount,
      billingCycle,
      paymentMethod: 'lonestar',
      transactionId: referenceId,
      momoReferenceId: referenceId,
      phone: payerPhone,
      status: 'pending',
      startDate,
      endDate,
    });

    try {
      await momo.requestToPay({
        referenceId,
        externalId: payment._id.toString(),
        amount: charge.amount,
        currency: charge.currency,
        phone: payerPhone,
        payerMessage: `LexLiberia ${plan.name} ${billingCycle}`,
      });
    } catch (error) {
      payment.status = 'failed';
      payment.failureReason = 'Could not reach Lonestar';
      await payment.save();
      throw error;
    }

    res.status(202).json({
      success: true,
      data: await paymentPayload(payment),
    });
  } catch (error) {
    sendError(res, error);
  }
};

exports.getMomoPaymentStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    const ownsPayment = payment.user.toString() === req.user._id.toString();
    if (!ownsPayment && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this payment',
      });
    }

    if (payment.status === 'pending' && payment.momoReferenceId) {
      try {
        const result = await momo.getRequestToPayStatus(payment.momoReferenceId);
        await applyMomoResult(payment, result);
      } catch (error) {
        if (error.name !== 'MomoRequestError') throw error;
      }
    }

    res.status(200).json({
      success: true,
      data: await paymentPayload(payment, { includeUser: true }),
    });
  } catch (error) {
    sendError(res, error);
  }
};

exports.momoCallback = async (req, res) => {
  try {
    const externalId = req.body?.externalId;
    const referenceId = req.body?.referenceId || req.get('X-Reference-Id');
    let payment = null;

    if (externalId && mongoose.Types.ObjectId.isValid(externalId)) {
      payment = await Payment.findById(externalId);
    }

    if (!payment && referenceId) {
      payment = await Payment.findOne({ momoReferenceId: referenceId });
    }

    if (payment?.status === 'pending' && payment.momoReferenceId) {
      const result = await momo.getRequestToPayStatus(payment.momoReferenceId);
      await applyMomoResult(payment, result);
    }
  } catch (error) {
    console.error('MoMo callback could not be confirmed');
  }

  res.status(200).json({ success: true });
};

// Direct completion is closed. A plan turns on only after Lonestar confirms.
exports.createPayment = (req, res) => {
  res.status(400).json({
    success: false,
    message: 'Pay with Lonestar from the pricing page. The plan stays locked until MTN confirms the payment.',
  });
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
