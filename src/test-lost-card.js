/**
 * Test script to simulate lost card reporting
 * Run: node src/test-lost-card.js
 */

require('dotenv').config();
const prisma = require('./lib/prisma');
const doorService = require('./services/door.service');

async function testLostCard() {
  console.log('🔐 Testing Lost Card Feature...\n');

  // Find a user with an active RFID card
  const userWithCard = await prisma.user.findFirst({
    where: {
      rfidCard: {
        status: 'ACTIVE'
      }
    },
    include: {
      rfidCard: true
    }
  });

  if (!userWithCard) {
    console.log('❌ No user with active RFID card found.');
    console.log('   Please register an RFID card first.\n');
    
    // List all users
    const users = await prisma.user.findMany({
      select: { id: true, username: true }
    });
    console.log('Available users:', users);
    return;
  }

  console.log(`✅ Found user with card: ${userWithCard.username}`);
  console.log(`   Card UID: ${userWithCard.rfidCard.uid}`);
  console.log(`   Card Status: ${userWithCard.rfidCard.status}\n`);

  console.log('📤 Simulating lost card report...');
  
  try {
    const result = await doorService.reportLostCard(userWithCard.id);
    console.log('✅ Card reported lost successfully!');
    console.log(`   Message: ${result.message}`);
    console.log(`   Card ID: ${result.card.id}`);
    console.log(`   Card UID: ${result.card.uid}\n`);

    // Verify the card is revoked
    const updatedCard = await prisma.rfidCard.findUnique({
      where: { id: userWithCard.rfidCard.id }
    });
    console.log(`📋 Card status after report: ${updatedCard.status}`);

    // Check access log
    const log = await prisma.doorAccessLog.findFirst({
      where: {
        userId: userWithCard.id,
        event: 'card_reported_lost'
      },
      orderBy: { timestamp: 'desc' }
    });
    
    if (log) {
      console.log(`📝 Access log created: ${log.event} at ${log.timestamp}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  console.log('\n✅ Test completed!');
}

testLostCard()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
