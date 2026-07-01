const Plan = require('../models/Plan');
const User = require('../models/User');

async function downgradeExpiredPlan(user) {
  if (!user.planExpiresAt || new Date(user.planExpiresAt) >= new Date()) {
    return user;
  }

  const freePlan = await Plan.findOne({ name: 'Free' });
  if (!freePlan) return user;

  user.plan = freePlan._id;
  user.planExpiresAt = null;
  await user.save();
  return user;
}

module.exports = downgradeExpiredPlan;
