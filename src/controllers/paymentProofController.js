const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const PaymentProof = require('../models/PaymentProof');
const Plan = require('../models/Plan');
const User = require('../models/User');
const PushSubscription = require('../models/PushSubscription');
const adminNotify = require('../services/adminNotify');

const PAY_TO = {
  name: process.env.MANUAL_PAY_NAME || 'Bill P. Alex',
  phone: process.env.MANUAL_PAY_PHONE || '0888907840',
  network: 'Lonestar MTN',
};

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

function publicProof(proof) {
  return {
    _id: proof._id,
    status: proof.status,
    amount: proof.amount,
    billingCycle: proof.billingCycle,
    approvedBillingCycle: proof.approvedBillingCycle || null,
    reviewNote: proof.reviewNote || '',
    createdAt: proof.createdAt,
    updatedAt: proof.updatedAt,
    reviewedAt: proof.reviewedAt || null,
    user: proof.user && typeof proof.user === 'object'
      ? { _id: proof.user._id, name: proof.user.name, email: proof.user.email }
      : proof.user,
    plan: proof.plan && typeof proof.plan === 'object'
      ? {
          _id: proof.plan._id,
          name: proof.plan.name,
          priceMonthly: proof.plan.priceMonthly,
          priceAnnual: proof.plan.priceAnnual,
        }
      : proof.plan,
    approvedPlan: proof.approvedPlan && typeof proof.approvedPlan === 'object'
      ? { _id: proof.approvedPlan._id, name: proof.approvedPlan.name }
      : proof.approvedPlan || null,
  };
}

async function loadPaidPlan(planId) {
  if (!mongoose.Types.ObjectId.isValid(planId)) return null;
  const plan = await Plan.findById(planId);
  if (!plan || plan.name === 'Free' || Number(plan.priceMonthly) <= 0) return null;
  return plan;
}

exports.getPayInstructions = (req, res) => {
  res.status(200).json({ success: true, data: PAY_TO });
};

exports.submitProof = async (req, res) => {
  try {
    const { planId, billingCycle } = req.body;
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        message: 'Choose a monthly or annual plan.',
      });
    }

    const plan = await loadPaidPlan(planId);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Choose a paid plan.' });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Upload a screenshot of the Lonestar message.',
      });
    }

    const amount = billingCycle === 'annual' ? plan.priceAnnual : plan.priceMonthly;
    const image = {
      image: req.file.buffer,
      imageType: req.file.mimetype || 'image/jpeg',
      plan: plan._id,
      billingCycle,
      amount,
      status: 'pending',
      reviewNote: '',
      reviewedAt: null,
    };

    let proof = await PaymentProof.findOne({ user: req.user._id, status: 'pending' });
    if (proof) {
      Object.assign(proof, image);
      await proof.save();
    } else {
      proof = await PaymentProof.create({ user: req.user._id, ...image });
    }

    try {
      await adminNotify.notifyAdminsOfProof(proof);
    } catch (error) {
      console.error('Payment alert could not be sent');
    }

    const saved = await PaymentProof.findById(proof._id).populate('plan', 'name priceMonthly priceAnnual');
    res.status(201).json({
      success: true,
      message: 'Screenshot sent. Your plan stays locked until the admin confirms it.',
      data: publicProof(saved),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.myProof = async (req, res) => {
  try {
    const proof = await PaymentProof.findOne({ user: req.user._id })
      .sort('-updatedAt')
      .populate('plan', 'name priceMonthly priceAnnual')
      .populate('approvedPlan', 'name');

    res.status(200).json({
      success: true,
      data: proof ? publicProof(proof) : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listProofs = async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const proofs = await PaymentProof.find({ status })
      .sort('-updatedAt')
      .populate('user', 'name email')
      .populate('plan', 'name priceMonthly priceAnnual')
      .populate('approvedPlan', 'name');

    res.status(200).json({
      success: true,
      count: proofs.length,
      data: proofs.map(publicProof),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.countPendingProofs = async (req, res) => {
  try {
    const count = await PaymentProof.countDocuments({ status: 'pending' });
    res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.proofScreenshot = async (req, res) => {
  try {
    const proof = await PaymentProof.findById(req.params.id).select('+image');
    if (!proof?.image) {
      return res.status(404).json({ success: false, message: 'Screenshot not found' });
    }

    res.set('Content-Type', proof.imageType || 'image/jpeg');
    res.set('Cache-Control', 'private, no-store');
    res.send(proof.image);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveProof = async (req, res) => {
  try {
    const { planId, billingCycle } = req.body;
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        message: 'Choose monthly or annual.',
      });
    }

    const proof = await PaymentProof.findById(req.params.id);
    if (!proof || proof.status !== 'pending') {
      return res.status(404).json({
        success: false,
        message: 'This payment is no longer waiting.',
      });
    }

    const plan = await loadPaidPlan(planId || proof.plan);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Choose a paid plan.' });
    }

    const { startDate, endDate } = expiryDate(billingCycle);
    await User.findByIdAndUpdate(proof.user, {
      plan: plan._id,
      planExpiresAt: endDate,
    });

    proof.status = 'approved';
    proof.approvedPlan = plan._id;
    proof.approvedBillingCycle = billingCycle;
    proof.reviewedAt = new Date();
    proof.reviewNote = '';
    await proof.save();

    await Payment.create({
      user: proof.user,
      plan: plan._id,
      amount: billingCycle === 'annual' ? plan.priceAnnual : plan.priceMonthly,
      currency: 'USD',
      billingCycle,
      paymentMethod: 'manual-lonestar',
      transactionId: `proof-${proof._id}`,
      status: 'completed',
      startDate,
      endDate,
    });

    const saved = await PaymentProof.findById(proof._id)
      .populate('user', 'name email')
      .populate('plan', 'name priceMonthly priceAnnual')
      .populate('approvedPlan', 'name');

    res.status(200).json({
      success: true,
      message: `${saved.user?.name || 'User'} now has the ${plan.name} plan.`,
      data: publicProof(saved),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectProof = async (req, res) => {
  try {
    const proof = await PaymentProof.findById(req.params.id);
    if (!proof || proof.status !== 'pending') {
      return res.status(404).json({
        success: false,
        message: 'This payment is no longer waiting.',
      });
    }

    proof.status = 'rejected';
    proof.reviewedAt = new Date();
    proof.reviewNote = String(req.body?.note || 'The screenshot did not match a Lonestar payment.').slice(0, 300);
    await proof.save();

    const saved = await PaymentProof.findById(proof._id)
      .populate('user', 'name email')
      .populate('plan', 'name');

    res.status(200).json({ success: true, data: publicProof(saved) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.pushPublicKey = (req, res) => {
  res.status(200).json({
    success: true,
    data: { publicKey: adminNotify.publicKey() },
  });
};

exports.savePushSubscription = async (req, res) => {
  try {
    const subscription = req.body?.subscription;
    const endpoint = subscription?.endpoint;
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Missing push subscription.',
      });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { user: req.user._id, endpoint, subscription },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
