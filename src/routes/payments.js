const express = require('express');
const {
  createPayment,
  getPayments,
  getPayment,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.route('/')
  .get(protect, getPayments)
  .post(protect, createPayment);

router.route('/:id')
  .get(protect, getPayment);

module.exports = router;
