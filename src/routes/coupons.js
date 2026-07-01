const express = require('express');
const { redeemCoupon, getAccessProfile } = require('../controllers/couponController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/redeem', protect, redeemCoupon);
router.get('/access', protect, getAccessProfile);

module.exports = router;
