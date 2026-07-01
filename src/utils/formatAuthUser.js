async function formatAuthUser(userDoc) {
  const user = await userDoc.populate('plan');
  const accessControl = require('./accessControl');

  const plan =
    user.plan && typeof user.plan === 'object'
      ? {
          _id: user.plan._id,
          name: user.plan.name,
          description: user.plan.description,
          dailyViewLimit: user.plan.dailyViewLimit,
          priceMonthly: user.plan.priceMonthly,
        }
      : null;

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan,
    planExpiresAt: user.planExpiresAt ?? null,
    isActive: user.isActive,
    access: {
      isAdmin: accessControl.isAdmin(user),
      hasPaidPlan: accessControl.hasPaidPlan(user),
      isPlanExpired: accessControl.isPlanExpired(user),
      canViewPremiumDocuments: accessControl.canAccessPremiumContent(user),
      canUseAiResearch: accessControl.canUseAiResearch(user),
    },
  };
}

module.exports = formatAuthUser;
