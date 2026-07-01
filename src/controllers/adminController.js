const Document = require('../models/Document');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const Message = require('../models/Message');
const Notice = require('../models/Notice');
const { sendEmail, sendBulkEmail } = require('../utils/emailService');
const formatAuthUser = require('../utils/formatAuthUser');

exports.getStats = async (req, res) => {
  try {
    const [documents, users, plans] = await Promise.all([
      Document.countDocuments(),
      User.countDocuments({ role: 'user' }),
      Plan.countDocuments(),
    ]);

    res.status(200).json({
      success: true,
      data: { documents, users, plans },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' })
      .populate('plan', 'name priceMonthly')
      .sort('-createdAt')
      .select('name email role plan planExpiresAt isActive createdAt');

    const userIds = users.map((user) => user._id);
    const payments = await Payment.find({ user: { $in: userIds } })
      .populate('plan', 'name')
      .sort('-createdAt');

    const latestPaymentByUser = new Map();
    payments.forEach((payment) => {
      const key = payment.user.toString();
      if (!latestPaymentByUser.has(key)) {
        latestPaymentByUser.set(key, payment);
      }
    });

    const data = users.map((user) => {
      const payment = latestPaymentByUser.get(user._id.toString());
      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
        isActive: user.isActive,
        createdAt: user.createdAt,
        latestPayment: payment
          ? {
              amount: payment.amount,
              billingCycle: payment.billingCycle,
              paymentMethod: payment.paymentMethod,
              status: payment.status,
              startDate: payment.startDate,
              endDate: payment.endDate,
              planName: payment.plan?.name,
            }
          : null,
      };
    });

    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.disableUser = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'user' },
      { isActive: false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.enableUser = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'user' },
      { isActive: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findOneAndDelete({ _id: req.params.id, role: 'user' });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await Promise.all([
      Message.deleteMany({ $or: [{ recipient: user._id }, { sender: user._id }] }),
      Payment.deleteMany({ user: user._id }),
    ]);

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendUserMessage = async (req, res) => {
  try {
    const { userId, subject, body } = req.body;

    const recipient = await User.findOne({ _id: userId, role: 'user' });
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const message = await Message.create({
      recipient: recipient._id,
      sender: req.user._id,
      subject,
      body,
    });

    const emailResult = await sendEmail({
      to: recipient.email,
      subject: `[LexLiberia] ${subject}`,
      text: body,
      html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
    });

    message.emailSent = emailResult.sent;
    await message.save();

    res.status(201).json({
      success: true,
      data: message,
      email: emailResult,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createNotice = async (req, res) => {
  try {
    const { title, content, type = 'public' } = req.body;

    const notice = await Notice.create({
      title,
      content,
      type,
      createdBy: req.user._id,
    });

    let emailResults = [];

    if (type === 'email' || type === 'both') {
      const users = await User.find({ role: 'user', isActive: true }).select('email');
      const recipients = users.map((user) => user.email);
      emailResults = await sendBulkEmail(
        recipients,
        `[LexLiberia Notice] ${title}`,
        `<h2>${title}</h2><p>${content.replace(/\n/g, '<br/>')}</p>`,
        content
      );
      notice.emailResults = emailResults;
      await notice.save();
    }

    res.status(201).json({
      success: true,
      data: notice,
      emailResults,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminNotices = async (req, res) => {
  try {
    const notices = await Notice.find()
      .populate('createdBy', 'name email')
      .sort('-createdAt');

    res.status(200).json({ success: true, count: notices.length, data: notices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicNotices = async (req, res) => {
  try {
    const notices = await Notice.find({
      isPublished: true,
      type: { $in: ['public', 'both'] },
    })
      .sort('-createdAt')
      .limit(10)
      .select('title content createdAt');

    res.status(200).json({ success: true, data: notices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
