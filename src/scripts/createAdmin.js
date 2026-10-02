require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

connectDB();

async function createAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@lexliberia.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const name = process.env.ADMIN_NAME || 'LexLiberia Admin';
    const baseUsername = process.env.ADMIN_USERNAME ||
      (process.env.ADMIN_NAME || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '') ||
      (email.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '_') ||
      'admin';

    const existingAdmin = (email ? await User.findOne({ email }) : null) ||
      await User.findOne({ username: baseUsername });

    if (existingAdmin) {
      existingAdmin.name = name;
      existingAdmin.role = 'admin';
      if (email && !existingAdmin.email) existingAdmin.email = email;
      if (!existingAdmin.username) existingAdmin.username = baseUsername;

      if (process.env.ADMIN_PASSWORD) {
        existingAdmin.password = password;
      }

      await existingAdmin.save();
      console.log(`Admin user updated: ${existingAdmin.username}${existingAdmin.email ? ` (${existingAdmin.email})` : ''}`);
    } else {
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
      });
      console.log(`Admin user created: ${username}${email ? ` (${email})` : ''}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Failed to create admin user:', error);
    process.exit(1);
  }
}

createAdmin();
