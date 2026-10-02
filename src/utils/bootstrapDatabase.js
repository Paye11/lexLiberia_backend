const Plan = require('../models/Plan');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Category = require('../models/Category');

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
      'AI Research and Ask Me',
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
      'Unlimited AI Research and Ask Me',
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

  if (!password || !email) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin bootstrap.');
    return;
  }

  const name = process.env.ADMIN_NAME || 'LexLiberia Admin';
  const courtPlan = await Plan.findOne({ name: 'Court' });

  // Generate a sensible admin username from ADMIN_NAME or email
  const baseUsername = process.env.ADMIN_USERNAME ||
    (process.env.ADMIN_NAME || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '') ||
    (email.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '_') ||
    'admin';

  const existingAdminByEmail = email ? await User.findOne({ email }) : null;
  const existingAdminByUsername = await User.findOne({ username: baseUsername });

  let adminUser = existingAdminByEmail || existingAdminByUsername;

  if (adminUser) {
    adminUser.name = name;
    adminUser.role = 'admin';
    if (email && !adminUser.email) adminUser.email = email;
    if (!adminUser.username) adminUser.username = baseUsername;
    if (courtPlan) adminUser.plan = courtPlan._id;
    if (password) adminUser.password = password;
    await adminUser.save();
    console.log(`Admin user ready: ${adminUser.username}${adminUser.email ? ` (${adminUser.email})` : ''}`);
    return;
  }

  let username = baseUsername;
  let suffix = 0;
  while (await User.findOne({ username })) {
    suffix += 1;
    username = `${baseUsername}${suffix}`;
  }

  await User.create({
    name,
    username,
    email,
    password,
    role: 'admin',
    plan: courtPlan ? courtPlan._id : null,
  });

  console.log(`Admin user created: ${username}${email ? ` (${email})` : ''}`);
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

const DEFAULT_CATEGORIES = [
  { name: 'Constitution', slug: 'constitution', order: 1, description: 'The 1986 Constitution of the Republic of Liberia and amendments.' },
  { name: 'Civil Procedure Law', slug: 'civil-procedure', order: 2, description: 'Rules governing civil proceedings in Liberian courts.' },
  { name: 'Criminal Procedure Law', slug: 'criminal-procedure', order: 3, description: 'Rules governing criminal proceedings and prosecutions.' },
  { name: 'Penal Law', slug: 'penal', order: 4, description: 'Criminal offenses, punishments, and penal code provisions.' },
  { name: 'Judiciary Law', slug: 'judiciary', order: 5, description: 'Laws establishing and regulating the judiciary and courts.' },
  { name: 'Property Law', slug: 'property', order: 6, description: 'Real property, land tenure, and ownership laws.' },
  { name: 'Labor Law', slug: 'labor', order: 7, description: 'Employment relations, workers rights, and labor standards.' },
  { name: 'Revenue Code', slug: 'revenue', order: 8, description: 'Taxation, customs duties, and revenue administration.' },
  { name: 'Commercial Law', slug: 'commercial', order: 9, description: 'Business, commerce, companies, and trade regulations.' },
  { name: 'Election Law', slug: 'election', order: 10, description: 'Elections, voter registration, and political parties.' },
  { name: 'Environmental Law', slug: 'environmental', order: 11, description: 'Environmental protection, natural resources, and climate.' },
  { name: 'Supreme Court Opinions', slug: 'supreme-court-opinions', order: 12, description: 'Published opinions and judgments of the Supreme Court of Liberia.' },
  { name: 'Regulations', slug: 'regulations', order: 13, description: 'Delegated legislation, ministerial regulations, and agency rules.' },
  { name: 'Executive Orders', slug: 'executive-orders', order: 14, description: 'Orders and directives issued by the President of Liberia.' },
];

async function seedDefaultCategories() {
  const currentAdmin = await User.findOne({ role: 'admin' }).select('_id').lean();
  const createdBy = currentAdmin?._id || null;

  let added = 0;
  let updated = 0;
  for (const seed of DEFAULT_CATEGORIES) {
    // Find any existing row for this logical category — either by exact legacy slug
    // OR by exact display name. This covers any prior partial/incorrectly-slugified seed
    // rows that were created with the wrong slug (e.g. "civil-procedure-law") before
    // the pre-save hook was tightened to preserve explicit slugs.
    const existing = await Category.findOne({
      $or: [{ slug: seed.slug }, { name: seed.name }],
    });

    if (existing) {
      let dirty = false;
      // Normalize slug to the legacy canonical one — repair any bad rows
      if (String(existing.slug) !== String(seed.slug)) {
        existing.slug = seed.slug;
        dirty = true;
      }
      if (!existing.description || existing.description === '') {
        existing.description = seed.description || '';
        dirty = true;
      }
      if (typeof seed.order === 'number' && existing.order !== seed.order) {
        existing.order = seed.order;
        dirty = true;
      }
      if (!existing.isActive) {
        existing.isActive = true;
        dirty = true;
      }
      if (!existing.createdBy && createdBy) {
        existing.createdBy = createdBy;
        dirty = true;
      }
      if (!existing.name || existing.name !== seed.name) {
        existing.name = seed.name;
        dirty = true;
      }
      if (dirty) {
        try {
          await existing.save();
          updated += 1;
        } catch (saveErr) {
          // If the save fails on a duplicate-slug conflict (another row already
          // holds the canonical slug because we had both a good and a corrupt
          // row for the same category in the DB), keep the canonical one and
          // drop the duplicate by marking it for deletion later.
          if (saveErr && saveErr.code === 11000) {
            console.log(
              `[bootstrap] duplicate slug row for "${seed.slug}" — removing the extra stale category.`,
            );
            await Category.deleteOne({ _id: existing._id });
          } else {
            throw saveErr;
          }
        }
      }
      continue;
    }

    await Category.create({
      name: seed.name,
      slug: seed.slug,
      description: seed.description || '',
      order: typeof seed.order === 'number' ? seed.order : 0,
      isActive: true,
      createdBy,
    });
    added += 1;
  }

  if (added > 0 || updated > 0) {
    console.log(
      `Default categories seeded (${added} added, ${updated} corrected).`,
    );
  } else {
    console.log('Default categories already present and in good state.');
  }
}

async function closeTestGatewayAccess() {
  const freePlan = await Plan.findOne({ name: 'Free' });
  const opened = await Payment.find({
    paymentMethod: 'lonestar',
    status: 'completed',
  }).select('user');

  const userIds = [...new Set(opened.map((payment) => String(payment.user)))];
  if (freePlan && userIds.length > 0) {
    const result = await User.updateMany(
      { _id: { $in: userIds }, role: { $ne: 'admin' } },
      { plan: freePlan._id, planExpiresAt: null }
    );
    if (result.modifiedCount > 0) {
      console.log(`Closed test mobile-money access for ${result.modifiedCount} user(s).`);
    }
  }

  await Payment.updateMany(
    { paymentMethod: 'lonestar', status: { $in: ['completed', 'pending'] } },
    { status: 'failed', failureReason: 'Mobile money test gateway closed' }
  );
}

async function mentionAskMeOnPlans() {
  const replacements = [
    { name: 'Student', from: '50 AI research queries / month', to: 'AI Research and Ask Me' },
    { name: 'Lawyer', from: 'Unlimited AI legal research', to: 'Unlimited AI Research and Ask Me' },
  ];

  for (const item of replacements) {
    const plan = await Plan.findOne({ name: item.name });
    if (!plan || !Array.isArray(plan.features)) continue;
    if (!plan.features.includes(item.from)) continue;
    plan.features = plan.features.map((feature) => (feature === item.from ? item.to : feature));
    await plan.save();
    console.log(`Updated ${item.name} plan features for Ask Me.`);
  }
}

async function bootstrapDatabase() {
  await seedPlansIfEmpty();
  await seedDefaultCategories();
  await mentionAskMeOnPlans();
  await ensureAdminUser();
  await assignMissingFreePlans();
  await closeTestGatewayAccess();
}

module.exports = bootstrapDatabase;
