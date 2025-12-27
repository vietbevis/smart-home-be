const express = require('express');
const pushService = require('../services/push.service');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/', authenticate, async (req, res) => {
  try {
    const { token, platform } = req.body;
    const result = await pushService.registerToken(req.user.id, token, platform);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:token', authenticate, async (req, res) => {
  try {
    await pushService.removeToken(req.params.token);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
