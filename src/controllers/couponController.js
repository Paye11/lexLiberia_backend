const Coupon = require('../models/Coupon');
const Plan = require('../models/Plan');
const User = require('../models/User');
const formatAuthUser = require('../utils/formatAuthUser');
const { getPlanExpiryDate } = require('../utils/planExpiry');

exports.createCoupon = async (req, res) => {
  try {
    const { code, description, planId, maxUses, expiresAt } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found',
      });
    }

    const coupon = await Coupon.create({
      code: String(code).trim().toUpperCase(),
      description,
      plan: planId,
      maxUses: maxUses || 1,
      expiresAt: expiresAt || null,
      createdBy: req.user._id,
    });

    const populated = await Coupon.findById(coupon._id).populate('plan', 'name');

    res.status(201).json({
      success: true,
      data: populated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('plan', 'name priceMonthly')
      .populate('createdBy', 'name email')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: coupons.length,
      data: coupons,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deactivateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found',
      });
    }

    res.status(200).json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.redeemCoupon = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a coupon code',
      });
    }

    const coupon = await Coupon.findOne({
      code: String(code).trim().toUpperCase(),
      isActive: true,
    }).populate('plan');

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or inactive coupon code',
      });
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This coupon has expired',
      });
    }

    if (coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({
        success: false,
        message: 'This coupon has reached its usage limit',
      });
    }

    const user = await User.findById(req.user._id);
    user.plan = coupon.plan._id;
    user.planExpiresAt = getPlanExpiryDate(coupon.plan.name);
    await user.save();

    coupon.usedCount += 1;
    await coupon.save();

    res.status(200).json({
      success: true,
      message: `Coupon applied. Your plan is now ${coupon.plan.name}.`,
      user: await formatAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAccessProfile = async (req, res) => {
  try {
    const downgradeExpiredPlan = require('../utils/downgradeExpiredPlan');
    let user = await User.findById(req.user._id).populate('plan');
    user = await downgradeExpiredPlan(user);
    const accessControl = require('../utils/accessControl');

    res.status(200).json({
      success: true,
      data: {
        user: await formatAuthUser(user),
        access: {
          isAdmin: accessControl.isAdmin(user),
          hasPaidPlan: accessControl.hasPaidPlan(user),
          canViewPremiumDocuments: accessControl.canAccessPremiumContent(user),
          canUseAiResearch: accessControl.canUseAiResearch(user),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
