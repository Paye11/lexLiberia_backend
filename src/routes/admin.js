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
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);
router.delete('/coupons/:id', deactivateCoupon);

module.exports = router;
