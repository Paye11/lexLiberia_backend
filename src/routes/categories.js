const express = require('express');
const { listCategories, categoryStats } = require('../controllers/categoryController');
const { protect, optionalAuth, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(optionalAuth, listCategories);

router.route('/stats')
  .get(protect, authorize('admin'), categoryStats);

module.exports = router;
