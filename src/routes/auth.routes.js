const express = require('express');
const authService = require('../services/auth.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const user = await authService.register(req.body);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const result = await authService.login(req.body);
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// Change password (authenticated user)
router.patch('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Cần nhập mật khẩu hiện tại và mật khẩu mới' });
    }
    
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 4 ký tự' });
    }
    
    const result = await authService.changePassword(req.user.id, { currentPassword, newPassword });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update profile (authenticated user)
router.patch('/profile', authenticate, async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
    }
    
    const user = await authService.updateProfile(req.user.id, { username });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/users', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const users = await authService.getUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/users/:id/role', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const user = await authService.updateUserRole(parseInt(req.params.id), req.body.role);
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/users/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    await authService.deleteUser(parseInt(req.params.id));
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
