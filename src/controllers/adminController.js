const Document = require('../models/Document');
const User = require('../models/User');
const Plan = require('../models/Plan');

exports.getStats = async (req, res) => {
  try {
    const [documents, users, plans] = await Promise.all([
      Document.countDocuments(),
      User.countDocuments({ role: 'user' }),
      Plan.countDocuments(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        documents,
        users,
        plans,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' })
      .populate('plan', 'name')
      .sort('-createdAt')
      .select('name email role plan createdAt');

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
