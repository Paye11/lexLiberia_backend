require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const bootstrapDatabase = require('./utils/bootstrapDatabase');
const path = require('path');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (allowedOrigins.includes(normalized)) return true;

  // Allowed wildcards so Railway + Vercel deploys "just work" without manual re-listing:
  //  - any *.vercel.app preview/production domain
  //  - any *.up.railway.app domain
  //  - localhost on any port
  const host = normalized.toLowerCase();
  if (host.endsWith('.vercel.app')) return true;
  if (host.endsWith('.up.railway.app')) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(host)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(host)) return true;
  return false;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    console.error(
      `[CORS BLOCKED] origin=${origin || '(missing)'} | allowedOrigins=${JSON.stringify(allowedOrigins)} | ` +
      `Go to Railway → lexLiberia_backend → Variables → edit CLIENT_URL value and append the following exact string before the comma: ${origin || ''}`,
    );
    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/coupons', require('./routes/coupons'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/notices', require('./routes/notices'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/ai', require('./routes/ai'));

app.get('/', (req, res) => {
  res.send('LexLiberia API is running!');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
  });
});

const PORT = process.env.PORT || 5000;

function validateStartupEnv() {
  const missing = [];
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI && !process.env.DATABASE_URL) {
    missing.push('MONGODB_URI (or MONGO_URI / DATABASE_URL) → MongoDB Atlas connection string');
  }
  if (!process.env.JWT_SECRET) {
    missing.push('JWT_SECRET → long random string for signing auth tokens');
  }
  if (!process.env.CLIENT_URL) {
    missing.push('CLIENT_URL → comma-separated list of frontend domains, e.g. https://your-vercel-domain.vercel.app,http://localhost:3000');
  }
  if (missing.length > 0) {
    console.error('');
    console.error('❌ Startup stopped — missing required environment variables:');
    missing.forEach((m) => console.error(`   • ${m}`));
    console.error('');
    console.error('👉 Go to Railway → lexLiberia_backend service → Variables tab, add all the above, then click Restart.');
    console.error('');
    process.exit(1);
  }
}

async function startServer() {
  validateStartupEnv();
  await connectDB();
  try {
    await bootstrapDatabase();
  } catch (bootstrapErr) {
    console.error('Non-fatal bootstrapDatabase warning — server will continue starting:', bootstrapErr && bootstrapErr.message ? bootstrapErr.message : bootstrapErr);
  }

  app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  mongoose.connection.close();
  process.exit(1);
});
