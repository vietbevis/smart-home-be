const express = require('express');
const doorService = require('../services/door.service');
const mqttService = require('../services/mqtt.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// ==================== Single Door Management ====================

// Get the door (single door system)
router.get('/', authenticate, async (req, res) => {
  try {
    const door = await doorService.getDoor();
    res.json(door);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get door config for ESP32
router.get('/config', authenticate, async (req, res) => {
  try {
    const config = await doorService.getDoorConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PIN Management ====================

// Update PIN (Admin only)
router.patch('/pin', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { pin, currentPin } = req.body;
    
    if (!currentPin || currentPin.length !== 4 || !/^\d+$/.test(currentPin)) {
      return res.status(400).json({ error: 'Mã PIN hiện tại phải là 4 chữ số' });
    }
    
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ error: 'Mã PIN mới phải là 4 chữ số' });
    }
    
    const door = await doorService.updateDoorPin(pin, currentPin);
    
    // Publish to ESP32 via MQTT
    const pinHash = doorService.sha256(pin);
    mqttService.publish('door/config/pin', {
      action: 'update_pin',
      pinHash,
      timestamp: Date.now()
    });
    
    // Create alert for PIN change
    const alertService = require('../services/alert.service');
    await alertService.createAlert({
      type: 'door',
      level: 'INFO',
      message: `Mã PIN cửa đã được thay đổi bởi ${req.user.username}`
    });
    
    // Send push notification
    const pushService = require('../services/push.service');
    await pushService.sendToAll(
      'Mã PIN cửa đã thay đổi',
      `${req.user.username} đã thay đổi mã PIN cửa`
    );
    
    res.json({ message: 'Đã cập nhật PIN', doorId: door.id });
  } catch (error) {
    // Return 401 for wrong current PIN
    if (error.message === 'Mã PIN hiện tại không đúng') {
      return res.status(401).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

// ==================== RFID Enrollment Flow ====================

// Get all users with RFID status
router.get('/users-rfid-status', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const users = await doorService.getAllUsersWithRfidStatus();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get enrollment status
router.get('/enrollment/status', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const status = await doorService.getEnrollmentStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start RFID enrollment for a user (Admin only)
router.post('/enrollment/start', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { userId, confirmReplace } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Cần chọn người dùng' });
    }
    
    // Check if user has existing card
    const rfidStatus = await doorService.getUserRfidStatus(userId);
    
    if (rfidStatus.hasCard && !confirmReplace) {
      return res.status(409).json({ 
        error: 'Người dùng đã có thẻ RFID',
        requireConfirmation: true,
        existingCard: rfidStatus.card
      });
    }
    
    // Start enrollment
    const result = await doorService.startEnrollment(userId);
    
    // Send MQTT command to ESP32 to enter enrollment mode
    mqttService.publish('door/enrollment', {
      action: 'start',
      userId: result.userId,
      username: result.username,
      timestamp: Date.now()
    });
    
    res.json({ 
      message: 'Đã bắt đầu chế độ đăng ký thẻ',
      ...result
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Cancel enrollment (Admin only)
router.post('/enrollment/cancel', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    await doorService.cancelEnrollment();
    
    // Send MQTT command to ESP32 to exit enrollment mode
    mqttService.publish('door/enrollment', {
      action: 'cancel',
      timestamp: Date.now()
    });
    
    res.json({ message: 'Đã hủy chế độ đăng ký' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== RFID Management (User-linked) ====================

// Get users without RFID card
router.get('/users-without-card', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const users = await doorService.getUsersWithoutCard();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's RFID status
router.get('/rfid/user/:userId', authenticate, async (req, res) => {
  try {
    const status = await doorService.getUserRfidStatus(parseInt(req.params.userId));
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user's RFID status
router.get('/rfid/my-card', authenticate, async (req, res) => {
  try {
    const status = await doorService.getUserRfidStatus(req.user.id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Report lost card (user can report their own card)
router.post('/rfid/report-lost', authenticate, async (req, res) => {
  try {
    const result = await doorService.reportLostCard(req.user.id);
    
    // Publish updated whitelist to ESP32 immediately
    const whitelist = await doorService.getRfidWhitelist();
    mqttService.publish('door/config/rfid', {
      action: 'update_rfid',
      whitelist,
      timestamp: Date.now()
    });
    
    // Publish real-time notification to web clients
    mqttService.publish('home/rfid/lost', {
      userId: req.user.id,
      username: req.user.username,
      cardUid: result.card.uid,
      timestamp: Date.now()
    });
    
    // Create alert for admins
    const alertService = require('../services/alert.service');
    await alertService.createAlert({
      type: 'door',
      level: 'WARNING',
      message: `Thẻ RFID của ${req.user.username} đã được báo mất và vô hiệu hóa`
    });
    
    // Send push notification
    const pushService = require('../services/push.service');
    await pushService.sendToAll(
      'Thẻ RFID bị mất',
      `${req.user.username} đã báo mất thẻ RFID. Thẻ đã bị vô hiệu hóa.`
    );
    
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Add RFID card to user manually (Admin only) - Legacy support
router.post('/rfid', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { userId, uid } = req.body;
    if (!userId || !uid) {
      return res.status(400).json({ error: 'Cần userId và UID thẻ' });
    }
    
    const card = await doorService.addRfidCard(userId, uid);
    
    // Publish updated whitelist to ESP32
    const whitelist = await doorService.getRfidWhitelist();
    mqttService.publish('door/config/rfid', {
      action: 'update_rfid',
      whitelist,
      timestamp: Date.now()
    });
    
    res.status(201).json(card);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Revoke user's RFID card (Admin only)
router.post('/rfid/revoke/:userId', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    await doorService.revokeUserCard(userId);
    
    // Publish updated whitelist to ESP32
    const whitelist = await doorService.getRfidWhitelist();
    mqttService.publish('door/config/rfid', {
      action: 'update_rfid',
      whitelist,
      timestamp: Date.now()
    });
    
    res.json({ message: 'Đã thu hồi thẻ RFID' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Remove RFID card by ID (Admin only)
router.delete('/rfid/:cardId', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    await doorService.removeRfidCard(parseInt(req.params.cardId));
    
    // Publish updated whitelist to ESP32
    const whitelist = await doorService.getRfidWhitelist();
    mqttService.publish('door/config/rfid', {
      action: 'update_rfid',
      whitelist,
      timestamp: Date.now()
    });
    
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== Access Logs ====================

// Get access logs
router.get('/logs', authenticate, async (req, res) => {
  try {
    const { page, limit, event } = req.query;
    const logs = await doorService.getAccessLogs({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      eventFilter: event
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get door open/close history (read-only)
router.get('/history', authenticate, async (req, res) => {
  try {
    const { page, limit, event } = req.query;
    const history = await doorService.getDoorHistory({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      eventFilter: event
    });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== Commands ====================

// Remote unlock (Admin only)
router.post('/unlock', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    mqttService.publish('door/command', {
      action: 'unlock',
      timestamp: Date.now()
    });
    res.json({ message: 'Đã gửi lệnh mở khóa' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset alarm (Admin only)
router.post('/reset-alarm', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    mqttService.publish('door/command', {
      action: 'reset_alarm',
      timestamp: Date.now()
    });
    res.json({ message: 'Đã gửi lệnh reset alarm' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
