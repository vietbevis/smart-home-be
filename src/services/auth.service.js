const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

async function register({ username, password, role = 'USER' }) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new Error('Username already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  
  const user = await prisma.user.create({
    data: { username, passwordHash, role },
    select: { id: true, username: true, role: true }
  });

  return user;
}

async function login({ username, password }) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return {
    token,
    user: { id: user.id, username: user.username, role: user.role }
  };
}

async function getUsers() {
  return prisma.user.findMany({
    select: { id: true, username: true, role: true, createdAt: true }
  });
}

async function updateUserRole(userId, role) {
  return prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, username: true, role: true }
  });
}

async function deleteUser(userId) {
  return prisma.user.delete({ where: { id: userId } });
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('Người dùng không tồn tại');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error('Mật khẩu hiện tại không đúng');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  });

  return { message: 'Đã đổi mật khẩu thành công' };
}

async function updateProfile(userId, { username }) {
  // Check if username is taken by another user
  if (username) {
    const existing = await prisma.user.findFirst({
      where: { username, NOT: { id: userId } }
    });
    if (existing) throw new Error('Tên đăng nhập đã được sử dụng');
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { username },
    select: { id: true, username: true, role: true }
  });

  return user;
}

async function getUserById(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, role: true, createdAt: true }
  });
}

module.exports = { register, login, getUsers, updateUserRole, deleteUser, changePassword, updateProfile, getUserById };
