const User = require('../models/User');
const Plan = require('../models/Plan');
const formatAuthUser = require('../utils/formatAuthUser');
const downgradeExpiredPlan = require('../utils/downgradeExpiredPlan');

async function assignFreePlanIfMissing(user) {
  if (user.plan) return user;

  const freePlan = await Plan.findOne({ name: 'Free' });
  if (!freePlan) return user;

  user.plan = freePlan._id;
  await user.save();
  return user;
}

// @desc    Register a user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists',
      });
    }

    const freePlan = await Plan.findOne({ name: 'Free' });

    const user = await User.create({
      name,
      email,
      password,
      plan: freePlan ? freePlan._id : null,
    });

    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      token,
      user: await formatAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Login a user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email and password',
      });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (!user.isActive && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Contact support for help.',
      });
    }

    await assignFreePlanIfMissing(user);
    await downgradeExpiredPlan(user);
    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      token,
      user: await formatAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    let user = await User.findById(req.user._id);
    await assignFreePlanIfMissing(user);
    user = await downgradeExpiredPlan(user);

    res.status(200).json({
      success: true,
      user: await formatAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
