/**
 * Test script to send push notifications and real-time alerts
 * Run: node src/test-push-notification.js
 */

require('dotenv').config();
const pushService = require('./services/push.service');
const alertService = require('./services/alert.service');
const mqtt = require('mqtt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPushNotification() {
  console.log('🔔 Testing Push Notifications & Real-time Alerts...\n');

  // Connect to MQTT for real-time alerts
  const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
  });

  await new Promise((resolve) => {
    mqttClient.on('connect', () => {
      console.log('✅ MQTT connected');
      // Inject publish function into alert service
      alertService.setMqttPublish((topic, message) => {
        mqttClient.publish(topic, JSON.stringify(message));
      });
      resolve();
    });
  });

  // Check registered tokens
  const tokens = await prisma.pushToken.findMany({
    include: { user: { select: { username: true } } }
  });

  if (tokens.length === 0) {
    console.log('⚠️ No FCM tokens registered (push notifications will be skipped)');
  } else {
    console.log(`✅ Found ${tokens.length} registered token(s):`);
    tokens.forEach(t => {
      console.log(`   - User: ${t.user.username}, Platform: ${t.platform}`);
    });
  }

  console.log('\n📤 Creating test alert (will appear in real-time on web)...');

  try {
    // Create alert - this will:
    // 1. Save to database
    // 2. Publish to MQTT for real-time web updates
    const alert = await alertService.createAlert({
      type: 'door',
      level: 'WARNING',
      message: '⚠️ CẢNH BÁO THỬ NGHIỆM: Đây là thông báo realtime!'
    });
    
    console.log(`✅ Alert created: ID ${alert.id}`);
    console.log('📱 Check the web app - alert should appear instantly!');

    // Also send push notification
    if (tokens.length > 0) {
      console.log('\n📤 Sending push notification...');
      await pushService.sendToAll(
        '⚠️ CẢNH BÁO THỬ NGHIỆM',
        'Đây là thông báo thử nghiệm từ hệ thống Smart Home!'
      );
      console.log('✅ Push notification sent!');
    }

  } catch (error) {
    console.error('❌ Failed:', error.message);
  }

  // Disconnect MQTT
  mqttClient.end();
  console.log('\n✅ Test completed!');
}

testPushNotification()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
