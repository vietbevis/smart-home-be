const express = require('express');
const router = express.Router();
const pushService = require('../services/push.service');
const { authenticate } = require('../middleware/auth.middleware');

// Register FCM token
router.post('/register', authenticate, async (req, res) => {
  try {
    const { token, platform = 'web' } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    await pushService.registerToken(req.user.id, token, platform);
    res.json({ success: true, message: 'Token registered' });
  } catch (error) {
    console.error('Register token error:', error);
    res.status(500).json({ error: 'Failed to register token' });
  }
});

// Unregister FCM token
router.post('/unregister', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    await pushService.removeToken(token);
    res.json({ success: true, message: 'Token removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove token' });
  }
});

// Test notification (admin only)
router.post('/test', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    const { title, body, userId } = req.body;
    
    if (userId) {
      await pushService.sendToUser(userId, title || 'Test', body || 'Test notification');
    } else {
      await pushService.sendToAll(title || 'Test', body || 'Test notification');
    }
    
    res.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
