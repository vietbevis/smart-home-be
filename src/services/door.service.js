const prisma = require('../lib/prisma');
const crypto = require('crypto');

// SHA-256 hash function
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ==================== Single Door Management ====================

// Get or create the single door
async function getOrCreateDoor(pin = '1234') {
  let door = await prisma.door.findFirst();
  
  if (!door) {
    const pinHash = sha256(pin);
    door = await prisma.door.create({
      data: { name: 'Cửa chính', location: 'Tầng 1', pinHash }
    });
  }
  
  return door;
}

async function getDoor() {
  return prisma.door.findFirst({
    include: {
      rfidCards: {
        where: { status: 'ACTIVE' },
        include: {
          user: { select: { id: true, username: true, role: true } }
        }
      },
      _count: { select: { accessLogs: true } }
    }
  });
}

async function updateDoorPin(newPin, currentPin) {
  const door = await getOrCreateDoor();
  
  // Validate current PIN
  const currentPinHash = sha256(currentPin);
  if (door.pinHash !== currentPinHash) {
    throw new Error('Mã PIN hiện tại không đúng');
  }
  
  const pinHash = sha256(newPin);
  
  return prisma.door.update({
    where: { id: door.id },
    data: { pinHash }
  });
}

async function updateDoorStatus(isOnline) {
  const door = await getOrCreateDoor();
  
  return prisma.door.update({
    where: { id: door.id },
    data: { 
      isOnline,
      lastSeen: isOnline ? new Date() : undefined
    }
  });
}

// ==================== RFID Enrollment Flow ====================

// Start enrollment mode for a user
async function startEnrollment(userId) {
  const door = await getOrCreateDoor();
  
  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { rfidCard: true }
  });
  
  if (!user) {
    throw new Error('Người dùng không tồn tại');
  }
  
  // Check if user already has an active card
  const hasActiveCard = user.rfidCard && user.rfidCard.status === 'ACTIVE';
  
  // Update door to enrollment mode
  await prisma.door.update({
    where: { id: door.id },
    data: { 
      enrollmentMode: true,
      enrollmentUserId: userId
    }
  });
  
  return { 
    userId, 
    username: user.username,
    hasExistingCard: hasActiveCard,
    existingCardUid: user.rfidCard?.uid || null
  };
}

// Cancel enrollment mode
async function cancelEnrollment() {
  const door = await getOrCreateDoor();
  
  await prisma.door.update({
    where: { id: door.id },
    data: { 
      enrollmentMode: false,
      enrollmentUserId: null
    }
  });
}

// Process scanned RFID during enrollment (called from MQTT handler)
async function processEnrollmentScan(uid) {
  const door = await prisma.door.findFirst();
  
  if (!door || !door.enrollmentMode || !door.enrollmentUserId) {
    return { success: false, error: 'Không trong chế độ đăng ký' };
  }
  
  const userId = door.enrollmentUserId;
  const uidUpper = uid.toUpperCase();
  const uidHash = sha256(uidUpper);
  
  // Check if UID already exists and belongs to another ACTIVE user
  const existingCardWithUid = await prisma.rfidCard.findFirst({
    where: { 
      uidHash,
      status: 'ACTIVE',
      userId: { not: userId }
    },
    include: { user: true }
  });
  
  if (existingCardWithUid) {
    // UID belongs to another active user
    await prisma.door.update({
      where: { id: door.id },
      data: { enrollmentMode: false, enrollmentUserId: null }
    });
    
    return { 
      success: false, 
      error: `Thẻ đã được gán cho ${existingCardWithUid.user.username}` 
    };
  }
  
  // Delete any existing card with this UID (revoked cards from other users)
  await prisma.rfidCard.deleteMany({
    where: { uidHash, userId: { not: userId } }
  });
  
  // Delete current user's old card if exists (to avoid unique constraint)
  await prisma.rfidCard.deleteMany({
    where: { userId }
  });
  
  // Create new card
  const newCard = await prisma.rfidCard.create({
    data: {
      doorId: door.id,
      userId,
      uid: uidUpper,
      uidHash,
      status: 'ACTIVE'
    },
    include: {
      user: { select: { id: true, username: true } }
    }
  });
  
  // Exit enrollment mode
  await prisma.door.update({
    where: { id: door.id },
    data: { enrollmentMode: false, enrollmentUserId: null }
  });
  
  // Log enrollment
  await prisma.doorAccessLog.create({
    data: {
      doorId: door.id,
      userId,
      event: 'enrollment_success',
      rfidUid: uidUpper,
      method: 'enrollment'
    }
  });
  
  return { 
    success: true, 
    card: newCard,
    message: `Đã đăng ký thẻ cho ${newCard.user.username}`
  };
}

// Get enrollment status
async function getEnrollmentStatus() {
  const door = await prisma.door.findFirst({
    select: {
      enrollmentMode: true,
      enrollmentUserId: true
    }
  });
  
  if (!door || !door.enrollmentMode) {
    return { active: false };
  }
  
  const user = await prisma.user.findUnique({
    where: { id: door.enrollmentUserId },
    select: { id: true, username: true }
  });
  
  return {
    active: true,
    userId: door.enrollmentUserId,
    username: user?.username
  };
}

// ==================== RFID Card Management ====================

// Get user's RFID card status
async function getUserRfidStatus(userId) {
  const card = await prisma.rfidCard.findFirst({
    where: { userId, status: 'ACTIVE' }
  });
  
  return {
    hasCard: !!card,
    card: card ? {
      id: card.id,
      uid: card.uid,
      status: card.status,
      createdAt: card.createdAt
    } : null
  };
}

// Revoke user's RFID card
async function revokeUserCard(userId) {
  const card = await prisma.rfidCard.findFirst({
    where: { userId, status: 'ACTIVE' }
  });
  
  if (!card) {
    throw new Error('Người dùng không có thẻ RFID');
  }
  
  return prisma.rfidCard.update({
    where: { id: card.id },
    data: { status: 'REVOKED' }
  });
}

// Report lost card - user can report their own card as lost
async function reportLostCard(userId) {
  const card = await prisma.rfidCard.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { user: { select: { id: true, username: true } } }
  });
  
  if (!card) {
    throw new Error('Bạn không có thẻ RFID đang hoạt động');
  }
  
  // Revoke the card
  const revokedCard = await prisma.rfidCard.update({
    where: { id: card.id },
    data: { status: 'REVOKED' }
  });
  
  // Log the event
  const door = await getOrCreateDoor();
  await prisma.doorAccessLog.create({
    data: {
      doorId: door.id,
      userId,
      event: 'card_reported_lost',
      rfidUid: card.uid,
      method: 'user_report'
    }
  });
  
  return {
    success: true,
    card: {
      id: revokedCard.id,
      uid: revokedCard.uid,
      username: card.user.username
    },
    message: `Thẻ RFID của ${card.user.username} đã bị vô hiệu hóa`
  };
}

// Legacy: Add RFID card directly (for manual entry)
async function addRfidCard(userId, uid) {
  const door = await getOrCreateDoor();
  
  // Check if user already has an active card
  const existingUserCard = await prisma.rfidCard.findFirst({
    where: { userId, status: 'ACTIVE' }
  });
  
  if (existingUserCard) {
    throw new Error('Người dùng đã có thẻ RFID. Vui lòng thu hồi thẻ cũ trước.');
  }
  
  const uidUpper = uid.toUpperCase();
  const uidHash = sha256(uidUpper);
  
  // Check if UID already exists
  const existingUidCard = await prisma.rfidCard.findFirst({
    where: { uidHash, status: 'ACTIVE' }
  });
  
  if (existingUidCard) {
    throw new Error('UID thẻ đã được sử dụng');
  }
  
  return prisma.rfidCard.create({
    data: { 
      doorId: door.id, 
      userId,
      uid: uidUpper, 
      uidHash,
      status: 'ACTIVE'
    },
    include: {
      user: { select: { id: true, username: true } }
    }
  });
}

// Remove/Revoke RFID card
async function removeRfidCard(cardId) {
  return prisma.rfidCard.update({
    where: { id: cardId },
    data: { status: 'REVOKED' }
  });
}

// ==================== RFID Authentication (Normal Usage) ====================

async function authenticateRfid(uidHash) {
  const card = await prisma.rfidCard.findFirst({
    where: { uidHash },
    include: { 
      user: { select: { id: true, username: true, role: true } }
    }
  });
  
  if (!card) {
    return { allowed: false, reason: 'unknown_card' };
  }
  
  if (card.status === 'REVOKED') {
    return { 
      allowed: false, 
      reason: 'card_revoked',
      userId: card.userId,
      username: card.user.username
    };
  }
  
  // Card is active - access granted
  return {
    allowed: true,
    userId: card.userId,
    username: card.user.username,
    role: card.user.role
  };
}

async function getUserByRfidHash(uidHash) {
  const card = await prisma.rfidCard.findFirst({
    where: { uidHash, status: 'ACTIVE' },
    include: { user: true }
  });
  return card?.user || null;
}

async function getRfidWhitelist() {
  const door = await getOrCreateDoor();
  
  const cards = await prisma.rfidCard.findMany({
    where: { doorId: door.id, status: 'ACTIVE' },
    include: { user: { select: { username: true } } }
  });
  
  return cards.map(card => ({
    uidHash: card.uidHash,
    username: card.user.username
  }));
}

// ==================== Access Logs ====================

async function createAccessLog({ event, rfidUid, method, userId = null }) {
  const door = await getOrCreateDoor();
  
  // Find user by RFID if not provided
  if (!userId && rfidUid) {
    const uidHash = sha256(rfidUid.toUpperCase());
    const user = await getUserByRfidHash(uidHash);
    userId = user?.id || null;
  }
  
  return prisma.doorAccessLog.create({
    data: { doorId: door.id, userId, event, rfidUid, method }
  });
}

async function getAccessLogs({ page = 1, limit = 50, eventFilter }) {
  const door = await getOrCreateDoor();
  const where = { doorId: door.id };
  if (eventFilter) where.event = eventFilter;
  
  const [logs, total] = await Promise.all([
    prisma.doorAccessLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, username: true } }
      }
    }),
    prisma.doorAccessLog.count({ where })
  ]);
  
  return { logs, total, page, totalPages: Math.ceil(total / limit) };
}

// Get door open/close history (for display)
// NOTE: This only shows ACCESS events, not card management events like lost card reports
async function getDoorHistory({ page = 1, limit = 20, eventFilter }) {
  const door = await getOrCreateDoor();
  
  // Build where clause based on filter
  // IMPORTANT: card_reported_lost is excluded - it's a card management event, not an access event
  let eventCondition;
  if (eventFilter === 'granted') {
    eventCondition = { in: ['door_opened', 'access_granted'] };
  } else if (eventFilter === 'denied') {
    eventCondition = { in: ['access_denied', 'alarm_triggered'] };
  } else {
    // All ACCESS events only (excludes card_reported_lost, enrollment_success, enrollment_failed)
    eventCondition = { 
      in: [
        'door_opened', 
        'door_closed', 
        'access_granted', 
        'access_denied',
        'alarm_triggered'
      ] 
    };
  }
  
  const where = { 
    doorId: door.id,
    event: eventCondition
  };
  
  const [logs, total] = await Promise.all([
    prisma.doorAccessLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, username: true } }
      }
    }),
    prisma.doorAccessLog.count({ where })
  ]);
  
  return { 
    logs: logs.map(log => ({
      id: log.id,
      event: log.event,
      method: log.method,
      timestamp: log.timestamp,
      user: log.user
    })),
    total, 
    page, 
    totalPages: Math.ceil(total / limit) 
  };
}

// ==================== Config for ESP32 ====================

async function getDoorConfig() {
  const door = await getDoor();
  if (!door) return null;
  
  return {
    pinHash: door.pinHash,
    whitelist: door.rfidCards.map(card => ({
      uidHash: card.uidHash,
      username: card.user.username
    }))
  };
}

// Get users without RFID card (for assignment)
async function getUsersWithoutCard() {
  return prisma.user.findMany({
    where: { 
      OR: [
        { rfidCard: null },
        { rfidCard: { status: 'REVOKED' } }
      ]
    },
    select: { id: true, username: true, role: true }
  });
}

// Get all users with their RFID status
async function getAllUsersWithRfidStatus() {
  const users = await prisma.user.findMany({
    include: {
      rfidCard: {
        where: { status: 'ACTIVE' }
      }
    },
    orderBy: { username: 'asc' }
  });
  
  return users.map(user => ({
    id: user.id,
    username: user.username,
    role: user.role,
    hasRfidCard: !!user.rfidCard,
    rfidCard: user.rfidCard ? {
      id: user.rfidCard.id,
      uid: user.rfidCard.uid,
      status: user.rfidCard.status,
      createdAt: user.rfidCard.createdAt
    } : null
  }));
}

module.exports = {
  sha256,
  getOrCreateDoor,
  getDoor,
  updateDoorPin,
  updateDoorStatus,
  // Enrollment
  startEnrollment,
  cancelEnrollment,
  processEnrollmentScan,
  getEnrollmentStatus,
  // RFID management
  getUserRfidStatus,
  revokeUserCard,
  reportLostCard,
  addRfidCard,
  removeRfidCard,
  // Authentication
  authenticateRfid,
  getUserByRfidHash,
  getRfidWhitelist,
  // Logs
  createAccessLog,
  getAccessLogs,
  getDoorHistory,
  // Config
  getDoorConfig,
  getUsersWithoutCard,
  getAllUsersWithRfidStatus
};
