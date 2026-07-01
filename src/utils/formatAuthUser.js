async function formatAuthUser(userDoc) {
  const user = await userDoc.populate('plan');

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan:
      user.plan && typeof user.plan === 'object'
        ? {
            _id: user.plan._id,
            name: user.plan.name,
            description: user.plan.description,
            dailyViewLimit: user.plan.dailyViewLimit,
          }
        : null,
  };
}

module.exports = formatAuthUser;
