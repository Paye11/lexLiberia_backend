function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getPlanExpiryDate(planName) {
  if (planName === 'Free') return null;
  if (planName === 'Court') return addDays(new Date(), 365);
  return addDays(new Date(), 30);
}

module.exports = {
  addDays,
  getPlanExpiryDate,
};
