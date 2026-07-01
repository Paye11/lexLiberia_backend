const express = require('express');
const { getStats, getUsers } = require('../controllers/adminController');
const {
  createCoupon,
  getCoupons,
  deactivateCoupon,
} = require('../controllers/couponController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:id', deactivateCoupon);

module.exports = router;
