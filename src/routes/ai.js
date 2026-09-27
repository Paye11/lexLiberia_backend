const express = require('express');
const { research } = require('../controllers/aiController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/research', protect, research);

module.exports = router;
