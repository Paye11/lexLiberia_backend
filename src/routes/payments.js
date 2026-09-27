const express = require('express');
const {
  createPayment,
  getPayments,
  getPayment,
  getMomoConfig,
  requestMomoPayment,
  getMomoPaymentStatus,
  momoCallback,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/momo/config', getMomoConfig);
router.post('/momo/request', protect, requestMomoPayment);
router.post('/momo/callback', momoCallback);
router.get('/momo/:id/status', protect, getMomoPaymentStatus);

router.route('/')
  .get(protect, getPayments)
  .post(protect, createPayment);

router.route('/:id')
  .get(protect, getPayment);

module.exports = router;
