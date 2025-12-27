/**
 * Test Firebase Push Notification
 * 
 * Usage: node src/test-notification.js
 */

require('dotenv').config();
const pushService = require('./services/push.service');

async function testNotification() {
  console.log('🔔 Testing Firebase Push Notification...\n');
  
  // Check Firebase config
  console.log('Firebase Config:');
  console.log('  Project ID:', process.env.FIREBASE_PROJECT_ID || '❌ Missing');
  console.log('  Client Email:', process.env.FIREBASE_CLIENT_EMAIL || '❌ Missing');
  console.log('  Private Key:', process.env.FIREBASE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
  console.log('');

  try {
    // Send test notification to all registered devices
    await pushService.sendToAll(
      '🏠 Smart Home Test',
      'Đây là thông báo test từ hệ thống Smart Home!'
    );
    console.log('✅ Notification sent successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 'app/invalid-credential') {
      console.log('\n⚠️  Firebase credentials are invalid!');
      console.log('You need to:');
      console.log('1. Go to Firebase Console > Project Settings > Service Accounts');
      console.log('2. Click "Generate new private key"');
      console.log('3. Download the JSON file');
      console.log('4. Update .env with the correct values from the JSON file');
    }
  }
}

testNotification();
