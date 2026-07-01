const express = require('express');
const {
  getMyMessages,
  markMessageRead,
} = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', getMyMessages);
router.patch('/:id/read', markMessageRead);

module.exports = router;
