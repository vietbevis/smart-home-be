const express = require('express');
const alertService = require('../services/alert.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await alertService.getAccessLogs({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
