/**
 * Test script to insert mock door history events
 * Run: node src/test-door-history.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestDoorHistory() {
  console.log('🚪 Creating test door history events...\n');

  // Get or create door
  let door = await prisma.door.findFirst();
  if (!door) {
    door = await prisma.door.create({
      data: {
        name: 'Cửa chính',
        location: 'Tầng 1',
        pinHash: 'test-hash',
      },
    });
    console.log('✅ Created door:', door.id);
  }

  // Get a user for some events
  const user = await prisma.user.findFirst();

  // Create test events
  const testEvents = [
    {
      doorId: door.id,
      userId: user?.id || null,
      event: 'door_opened',
      method: 'web_admin',
      rfidUid: null,
      timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago
    },
    {
      doorId: door.id,
      userId: null,
      event: 'door_closed',
      method: 'system',
      rfidUid: null,
      timestamp: new Date(Date.now() - 4 * 60 * 1000), // 4 mins ago
    },
    {
      doorId: door.id,
      userId: user?.id || null,
      event: 'access_granted',
      method: 'rfid_pin',
      rfidUid: 'ABC123',
      timestamp: new Date(Date.now() - 3 * 60 * 1000), // 3 mins ago
    },
    {
      doorId: door.id,
      userId: null,
      event: 'door_closed',
      method: 'system',
      rfidUid: null,
      timestamp: new Date(Date.now() - 2 * 60 * 1000), // 2 mins ago
    },
    {
      doorId: door.id,
      userId: user?.id || null,
      event: 'door_opened',
      method: 'MQTT',
      rfidUid: null,
      timestamp: new Date(Date.now() - 1 * 60 * 1000), // 1 min ago
    },
    {
      doorId: door.id,
      userId: null,
      event: 'door_closed',
      method: 'system',
      rfidUid: null,
      timestamp: new Date(), // Now
    },
  ];

  // Insert events
  for (const event of testEvents) {
    const log = await prisma.doorAccessLog.create({ data: event });
    console.log(`✅ Created: ${event.event} - ${event.method} (${event.timestamp.toLocaleString('vi-VN')})`);
  }

  // Also create a test alert
  const alert = await prisma.alert.create({
    data: {
      type: 'door',
      level: 'WARNING',
      message: '⚠️ CẢNH BÁO: Phát hiện truy cập bất thường vào cửa chính!',
    },
  });
  console.log(`\n🚨 Created alert: ${alert.message}`);

  // Create more alerts for testing
  const alerts = [
    { type: 'fire', level: 'CRITICAL', message: '🔥 CẢNH BÁO CHÁY: Phát hiện lửa tại phòng khách!' },
    { type: 'gas', level: 'WARNING', message: '⚠️ CẢNH BÁO GAS: Nồng độ gas cao - 850 ppm' },
    { type: 'door', level: 'INFO', message: '🚪 Cửa được mở từ xa qua Web Admin' },
  ];

  for (const alertData of alerts) {
    const a = await prisma.alert.create({ data: alertData });
    console.log(`🚨 Created alert: ${a.message}`);
  }

  console.log('\n✅ Test data created successfully!');
  console.log('📱 Open the web app to see the door history and alerts.');
}

createTestDoorHistory()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
