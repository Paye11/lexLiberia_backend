function isAdmin(user) {
  return Boolean(user && user.role === 'admin');
}

function isPlanExpired(user) {
  if (!user?.planExpiresAt) return false;
  return new Date(user.planExpiresAt) < new Date();
}

function hasPaidPlan(user) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!user.isActive) return false;
  if (isPlanExpired(user)) return false;

  const plan = user.plan;
  if (!plan || typeof plan !== 'object') return false;

  return plan.name !== 'Free' && Number(plan.priceMonthly ?? 0) > 0;
}

function canAccessPremiumContent(user) {
  return isAdmin(user) || hasPaidPlan(user);
}

function canUseAiResearch(user) {
  if (isAdmin(user)) return true;
  return hasPaidPlan(user);
}

module.exports = {
  isAdmin,
  isPlanExpired,
  hasPaidPlan,
  canAccessPremiumContent,
  canUseAiResearch,
};
