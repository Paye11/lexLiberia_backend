const express = require('express');
const {
  getStats,
  getUsers,
  disableUser,
  enableUser,
  deleteUser,
  sendUserMessage,
  createNotice,
  getAdminNotices,
} = require('../controllers/adminController');
const {
  createCoupon,
  getCoupons,
  deactivateCoupon,
} = require('../controllers/couponController');
const {
  listProofs,
  countPendingProofs,
  proofScreenshot,
  approveProof,
  rejectProof,
  pushPublicKey,
  savePushSubscription,
  testPush,
} = require('../controllers/paymentProofController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect, authorize('admin'));

router.get('/stats', getStats);
router.get('/users', getUsers);
router.patch('/users/:id/disable', disableUser);
router.patch('/users/:id/enable', enableUser);
router.delete('/users/:id', deleteUser);
router.post('/messages', sendUserMessage);
router.get('/notices', getAdminNotices);
router.post('/notices', createNotice);
router.get('/payment-proofs/count', countPendingProofs);
router.get('/payment-proofs', listProofs);
router.get('/payment-proofs/:id/screenshot', proofScreenshot);
router.post('/payment-proofs/:id/approve', approveProof);
router.post('/payment-proofs/:id/reject', rejectProof);
router.get('/push/public-key', pushPublicKey);
router.post('/push/subscribe', savePushSubscription);
router.post('/push/test', testPush);
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:id', deactivateCoupon);

module.exports = router;
