const express = require('express');
const alertService = require('../services/alert.service');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { page, limit, type, level } = req.query;
    const result = await alertService.getAlerts({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      type,
      level
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/acknowledge', authenticate, async (req, res) => {
  try {
    const alert = await alertService.acknowledgeAlert(
      parseInt(req.params.id),
      req.user.id
    );
    res.json(alert);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
