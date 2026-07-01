function isAdmin(user) {
  return Boolean(user && user.role === 'admin');
}

function hasPaidPlan(user) {
  if (!user) return false;
  if (isAdmin(user)) return true;

  const plan = user.plan;
  if (!plan || typeof plan !== 'object') return false;

  return plan.name !== 'Free' && Number(plan.priceMonthly ?? 0) > 0;
}

function canAccessPremiumContent(user) {
  return isAdmin(user) || hasPaidPlan(user);
}

function canUseAiResearch(user) {
  return canAccessPremiumContent(user);
}

module.exports = {
  isAdmin,
  hasPaidPlan,
  canAccessPremiumContent,
  canUseAiResearch,
};
