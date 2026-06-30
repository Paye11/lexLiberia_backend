require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

connectDB();

async function createAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@lexliberia.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const name = process.env.ADMIN_NAME || 'LexLiberia Admin';

    const existingAdmin = await User.findOne({ email });

    if (existingAdmin) {
      existingAdmin.name = name;
      existingAdmin.role = 'admin';

      if (process.env.ADMIN_PASSWORD) {
        existingAdmin.password = password;
      }

      await existingAdmin.save();
      console.log(`Admin user updated: ${email}`);
    } else {
      await User.create({
        name,
        email,
        password,
        role: 'admin',
      });
      console.log(`Admin user created: ${email}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Failed to create admin user:', error);
    process.exit(1);
  }
}

createAdmin();
