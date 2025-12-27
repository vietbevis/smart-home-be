const admin = require('firebase-admin');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const prisma = new PrismaClient();

// Initialize Firebase Admin (lazy init)
let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized) return true;
  
  try {
    // Try to use JSON file first
    const serviceAccountPath = path.join(__dirname, '../../firebase/smarthome-babad-firebase-adminsdk-fbsvc-4ed7c28b0a.json');
    const serviceAccount = require(serviceAccountPath);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized from JSON file');
    return true;
  } catch (error) {
    console.log('⚠️ JSON file not found, trying env variables...');
    // Fallback to env variables
    if (process.env.FIREBASE_PROJECT_ID) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL
          })
        });
        firebaseInitialized = true;
        console.log('✅ Firebase Admin initialized from env');
        return true;
      } catch (envError) {
        console.error('❌ Firebase init from env failed:', envError.message);
      }
    }
    console.error('❌ Firebase Admin not initialized:', error.message);
    return false;
  }
}

async function registerToken(userId, token, platform) {
  return prisma.pushToken.upsert({
    where: { token },
    update: { userId, platform },
    create: { userId, token, platform }
  });
}

async function removeToken(token) {
  return prisma.pushToken.delete({ where: { token } }).catch(() => null);
}

async function sendToUser(userId, title, body) {
  initFirebase();
  if (!firebaseInitialized) return;

  const tokens = await prisma.pushToken.findMany({
    where: { userId },
    select: { token: true }
  });

  if (tokens.length === 0) return;

  const message = {
    notification: { title, body },
    tokens: tokens.map(t => t.token)
  };

  try {
    await admin.messaging().sendEachForMulticast(message);
  } catch (error) {
    console.error('FCM send error:', error);
  }
}

async function sendToAll(title, body) {
  initFirebase();
  if (!firebaseInitialized) {
    console.log('⚠️ Firebase not initialized - skipping push notification');
    return;
  }

  const tokens = await prisma.pushToken.findMany({ select: { token: true, id: true } });
  if (tokens.length === 0) {
    console.log('⚠️ No FCM tokens registered');
    return;
  }

  const message = {
    notification: { title, body },
    tokens: tokens.map(t => t.token)
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`FCM sent: ${response.successCount} success, ${response.failureCount} failed`);
    
    // Log failures and remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.log(`  ❌ Token ${idx} failed:`, resp.error?.code, resp.error?.message);
          // Remove invalid tokens
          if (resp.error?.code === 'messaging/invalid-registration-token' ||
              resp.error?.code === 'messaging/registration-token-not-registered') {
            failedTokens.push(tokens[idx].id);
          }
        }
      });
      
      // Clean up invalid tokens
      if (failedTokens.length > 0) {
        await prisma.pushToken.deleteMany({
          where: { id: { in: failedTokens } }
        });
        console.log(`  🧹 Removed ${failedTokens.length} invalid token(s)`);
      }
    }
  } catch (error) {
    console.error('FCM send error:', error);
  }
}

module.exports = { registerToken, removeToken, sendToUser, sendToAll };
