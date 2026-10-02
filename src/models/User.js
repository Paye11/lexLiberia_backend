const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const usernameRegex = /^[A-Za-z0-9 \-_.']+$/;

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
    },
    username: {
      type: String,
      required: [true, 'Please add a username'],
      unique: true,
      trim: true,
      minlength: [2, 'Username must be at least 2 characters'],
      maxlength: [32, 'Username is too long (max 32 characters)'],
    },
    email: {
      type: String,
      required: false,
      sparse: true,
      unique: true,
      default: null,
      match: [
        /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'If provided, please add a valid email',
      ],
    },
    password: {
      type: String,
      minlength: [4, 'Password must be at least 4 characters'],
      select: false,
      required: function passwordRequired() {
        return !this.googleId;
      },
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      default: null,
    },
    planExpiresAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    documentViewsToday: {
      type: Number,
      default: 0,
    },
    lastViewDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Normalize username & email before saving
UserSchema.pre('save', function (next) {
  if (this.isModified('username')) {
    const trimmed = String(this.username || '').trim();
    if (trimmed && !usernameRegex.test(trimmed)) {
      next(new Error('Username can contain letters, numbers, spaces, hyphens, underscores, periods, and apostrophes'));
      return;
    }
    this.username = trimmed || undefined;
  }

  if (this.isModified('email')) {
    const emailVal = this.email;
    if (emailVal === '' || emailVal == null) {
      this.email = null;
    }
  }

  next();
});

// Encrypt password using bcrypt
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Sign JWT and return
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Match user entered password to hashed password in database
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
