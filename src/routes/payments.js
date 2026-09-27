const express = require('express');
const multer = require('multer');
const path = require('path');
const { createPayment, getPayments, getPayment } = require('../controllers/paymentController');
const {
  getPayInstructions,
  submitProof,
  myProof,
} = require('../controllers/paymentProofController');
const { protect } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const type = String(file.mimetype || '').toLowerCase();
    const allowedExtension = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension);
    const allowedType = type.startsWith('image/');
    if (allowedExtension || allowedType) {
      callback(null, true);
      return;
    }
    callback(new Error('Upload a photo of the Lonestar message.'));
  },
});

const router = express.Router();

router.get('/instructions', getPayInstructions);
router.get('/proof/mine', protect, myProof);
router.post('/proof', protect, (req, res, next) => {
  upload.single('screenshot')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The screenshot is larger than 5 MB. Take a smaller photo.'
      : error.message;
    res.status(400).json({ success: false, message });
  });
}, submitProof);

router.route('/')
  .get(protect, getPayments)
  .post(protect, createPayment);

router.route('/:id')
  .get(protect, getPayment);

module.exports = router;
