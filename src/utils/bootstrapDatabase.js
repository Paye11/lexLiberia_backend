const Plan = require('../models/Plan');
const User = require('../models/User');

const defaultPlans = [
  {
    name: 'Free',
    description: 'For curious citizens exploring Liberian law.',
    priceMonthly: 0,
    priceAnnual: 0,
    features: [
      'Browse public laws & the Constitution',
      'Basic keyword search',
      'Community support',
      'Premium admin uploads require a paid plan',
    ],
    dailyViewLimit: 0,
  },
  {
    name: 'Student',
    description: 'For law students and academic researchers.',
    priceMonthly: 5,
    priceAnnual: Math.round(5 * 12 * 0.95),
    features: [
      'Everything in Free',
      'Unlimited document views',
      'Supreme Court opinions access',
      'Bookmarks & downloads',
      '50 AI research queries / month',
    ],
    dailyViewLimit: 0,
  },
  {
    name: 'Lawyer',
    description: 'For practicing attorneys and firms.',
    priceMonthly: 25,
    priceAnnual: Math.round(25 * 12 * 0.95),
    recommended: true,
    features: [
      'Everything in Student',
      'Advanced filters & citations',
      'Unlimited AI legal research',
      'Related cases & cross-references',
      'PDF export & print',
      'Priority support',
    ],
    dailyViewLimit: 0,
  },
  {
    name: 'Court',
    description: 'For courts, ministries, and institutions.',
    priceMonthly: 35,
    priceAnnual: Math.round(35 * 12 * 0.95),
    features: [
      'Everything in Lawyer',
      'Multi-seat institutional access',
      'Internal annotations & sharing',
      'Dedicated account manager',
      'Custom onboarding & training',
    ],
    dailyViewLimit: 0,
  },
];

async function seedPlansIfEmpty() {
  const count = await Plan.countDocuments();
  if (count > 0) {
    console.log(`Plans already seeded (${count} found).`);
    return;
  }

  await Plan.insertMany(defaultPlans);
  console.log('Default subscription plans seeded.');
}

async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin bootstrap.');
    return;
  }

  const name = process.env.ADMIN_NAME || 'LexLiberia Admin';
  const courtPlan = await Plan.findOne({ name: 'Court' });
  const existingAdmin = await User.findOne({ email });

  if (existingAdmin) {
    existingAdmin.name = name;
    existingAdmin.role = 'admin';
    if (courtPlan) {
      existingAdmin.plan = courtPlan._id;
    }
    if (password) {
      existingAdmin.password = password;
    }
    await existingAdmin.save();
    console.log(`Admin user ready: ${email}`);
    return;
  }

  await User.create({
    name,
    email,
    password,
    role: 'admin',
    plan: courtPlan ? courtPlan._id : null,
  });

  console.log(`Admin user created: ${email}`);
}

async function assignMissingFreePlans() {
  const freePlan = await Plan.findOne({ name: 'Free' });
  if (!freePlan) return;

  const result = await User.updateMany(
    { role: 'user', plan: null },
    { plan: freePlan._id },
  );

  if (result.modifiedCount > 0) {
    console.log(`Assigned Free plan to ${result.modifiedCount} user(s).`);
  }
}

async function bootstrapDatabase() {
  await seedPlansIfEmpty();
  await ensureAdminUser();
  await assignMissingFreePlans();
}

module.exports = bootstrapDatabase;
