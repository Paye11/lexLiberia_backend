require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const connectDB = require('../config/db');

connectDB();

const seedPlans = async () => {
  try {
    await Plan.deleteMany();

    const plans = [
      {
        name: 'Free',
        description: 'For curious citizens exploring Liberian law.',
        priceMonthly: 0,
        priceAnnual: 0,
        features: [
          'Browse public laws & the Constitution',
          'Basic keyword search',
          '2 document views per day',
          'Community support',
        ],
        dailyViewLimit: 2,
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

    await Plan.insertMany(plans);
    console.log('Plans seeded successfully!');
    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedPlans();
