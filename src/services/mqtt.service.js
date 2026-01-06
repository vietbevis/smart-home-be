const mqtt = require('mqtt');
const alertService = require('./alert.service');
const pushService = require('./push.service');

let client = null;
const deviceLastSeen = new Map();
const OFFLINE_THRESHOLD = parseInt(process.env.ESP32_OFFLINE_THRESHOLD_MS) || 30000;

const TOPICS = [
  'home/sensor/fire',
  'home/sensor/gas',
  'home/door/state',
  'home/device/heartbeat',
  // Single door access topics
  'door/access',
  'door/alarm',
  'door/status',
  // RFID enrollment topics
  'door/rfid/check',
  'door/rfid/auth',
  // Enrollment result (for logging)
  'door/enrollment/result'
];

function connect() {
  const BROKER_URL = process.env.MQTT_BROKER_URL || "wss://emqx-ws.vittapcode.id.vn/mqtt";

  const options = {
    clientId: "smart_home_backend_" + Math.random().toString(16).slice(2, 10),
    username: process.env.MQTT_USERNAME || "test",
    password: process.env.MQTT_PASSWORD || "viet",
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 5000,
    protocolVersion: 4
  };

  console.log("Connecting to:", BROKER_URL);

  client = mqtt.connect(BROKER_URL, options);

  client.on('connect', () => {
    console.log('MQTT connected');
    TOPICS.forEach(topic => client.subscribe(topic));

    // Inject publish function into alert service for real-time alerts
    alertService.setMqttPublish(publish);
  });

  client.on('message', handleMessage);
  client.on('error', (err) => console.error('MQTT error:', err));

  // Check for offline devices every 10 seconds
  setInterval(checkOfflineDevices, 10000);
}

async function handleMessage(topic, message) {
  const payload = JSON.parse(message.toString());
  console.log(`MQTT [${topic}]:`, payload);

  if (topic === 'home/sensor/fire') {
    await handleFireAlert(payload);
  } else if (topic === 'home/sensor/gas') {
    await handleGasAlert(payload);
  } else if (topic === 'home/door/state') {
    await handleDoorEvent(payload);
  } else if (topic === 'home/device/heartbeat') {
    deviceLastSeen.set(payload.deviceId, Date.now());
  }
  // Door access system topics
  else if (topic.startsWith('door/')) {
    await handleDoorAccessMessage(topic, payload);
  }
}

// ==================== Single Door Access Handlers ====================
const doorService = require('./door.service');

async function handleDoorAccessMessage(topic, payload) {
  if (topic === 'door/access') {
    // Log access attempt with user lookup
    await doorService.createAccessLog({
      event: payload.event,
      rfidUid: payload.rfidUid,
      method: payload.method
    });

    // Get username for notification
    let username = 'Unknown';
    if (payload.rfidUid) {
      const uidHash = doorService.sha256(payload.rfidUid.toUpperCase());
      const user = await doorService.getUserByRfidHash(uidHash);
      username = user?.username || payload.rfidUid;
    }

    // Send push notification for denied access
    if (payload.event === 'access_denied') {
      await pushService.sendToAll('🚪 Truy cập bị từ chối', `${username} - ${payload.method}`);
    }
  }
  else if (topic === 'door/alarm') {
    // Log alarm and send notification
    await doorService.createAccessLog({
      event: 'alarm_triggered',
      rfidUid: payload.lastRfid,
      method: payload.reason
    });

    await alertService.createAlert({
      type: 'door',
      level: 'CRITICAL',
      message: `Cảnh báo cửa: ${payload.reason} (${payload.failCount} lần thất bại)`
    });

    await pushService.sendToAll('🚨 CẢNH BÁO CỬA!', payload.reason);
  }
  else if (topic === 'door/status') {
    // Update door online status
    await doorService.updateDoorStatus(payload.online);
    deviceLastSeen.set('door', Date.now());
  }
  // ==================== RFID Handlers ====================
  else if (topic === 'door/rfid/check') {
    // Check if in enrollment mode first
    const enrollmentStatus = await doorService.getEnrollmentStatus();
    if (enrollmentStatus.active) {
      // Enrollment mode - register new card
      await handleEnrollmentScan(payload);
    } else {
      // Normal mode - authenticate card
      await handleRfidAuth(payload);
    }
  }
  else if (topic === 'door/rfid/auth') {
    // ESP32 requesting RFID authentication (normal usage)
    await handleRfidAuth(payload);
  }
}

// Handle RFID scan during enrollment
async function handleEnrollmentScan(payload) {
  const { uid } = payload;
  
  console.log('📥 handleEnrollmentScan called with UID:', uid);

  if (!uid) {
    publish('door/enrollment/result', {
      success: false,
      error: 'UID không hợp lệ',
      timestamp: Date.now()
    });
    return;
  }

  try {
    // Check enrollment status first
    const enrollmentStatus = await doorService.getEnrollmentStatus();
    console.log('📋 Enrollment status:', enrollmentStatus);
    
    const result = await doorService.processEnrollmentScan(uid);
    console.log('📋 processEnrollmentScan result:', result);

    // Send result back to ESP32
    publish('door/enrollment/result', {
      success: result.success,
      message: result.success ? result.message : result.error,
      username: result.card?.user?.username,
      timestamp: Date.now()
    });

    // If successful, also update the whitelist
    if (result.success) {
      const whitelist = await doorService.getRfidWhitelist();
      publish('door/config/rfid', {
        action: 'update_rfid',
        whitelist,
        timestamp: Date.now()
      });

      // Send push notification
      await pushService.sendToAll(
        '✅ Đăng ký thẻ RFID',
        `Đã đăng ký thẻ cho ${result.card.user.username}`
      );
    }
  } catch (error) {
    console.error('Enrollment scan error:', error);
    publish('door/enrollment/result', {
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
}

// Handle RFID authentication request (normal usage)
async function handleRfidAuth(payload) {
  const { uidHash, uid } = payload;

  if (!uidHash && !uid) {
    publish('door/rfid/result', {
      uid: uid || '',
      allow: false,
      reason: 'invalid_request',
      timestamp: Date.now()
    });
    return;
  }

  try {
    // Use uidHash if provided, otherwise hash the uid
    const hash = uidHash || doorService.sha256(uid.toUpperCase());
    const result = await doorService.authenticateRfid(hash);

    // Send response to ESP32 (topic: door/rfid/result)
    publish('door/rfid/result', {
      uid: uid,
      allow: result.allowed,
      username: result.username || 'Unknown',
      reason: result.reason,
      timestamp: Date.now()
    });

    // Log the access attempt
    await doorService.createAccessLog({
      event: result.allowed ? 'access_granted' : 'access_denied',
      rfidUid: uid || 'HASHED',
      method: result.reason || 'rfid',
      userId: result.userId
    });

    // Send notification for denied access
    if (!result.allowed && result.reason !== 'unknown_card') {
      await pushService.sendToAll(
        '🚪 Truy cập bị từ chối',
        `${result.username || 'Unknown'} - ${result.reason}`
      );
    }
  } catch (error) {
    console.error('RFID auth error:', error);
    publish('door/rfid/result', {
      uid: payload.uid || '',
      allow: false,
      reason: 'server_error',
      timestamp: Date.now()
    });
  }
}

async function handleFireAlert(payload) {
  if (payload.detected) {
    const alert = await alertService.createAlert({
      type: 'fire',
      level: 'CRITICAL',
      message: `Fire detected at ${payload.location || 'unknown location'}`
    });
    await pushService.sendToAll('🔥 Fire Alert!', alert.message);
  }
}

async function handleGasAlert(payload) {
  if (payload.level > (payload.threshold || 500)) {
    const alert = await alertService.createAlert({
      type: 'gas',
      level: payload.level > 800 ? 'CRITICAL' : 'WARNING',
      message: `Gas leak detected: ${payload.level} ppm`
    });
    await pushService.sendToAll('⚠️ Gas Leak!', alert.message);
  }
}

async function handleDoorEvent(payload) {
  const { status, state, actor, abnormal } = payload;

  // Use 'status' (from new format) or 'state' (from old format)
  const eventType = status || state;

  if (eventType) {
    await alertService.createAccessLog({
      eventType: eventType,
      actor: actor || 'unknown'
    });

    // Log door open/close events to DoorAccessLog for history
    const event = eventType === 'open' ? 'door_opened' : 'door_closed';
    await doorService.createAccessLog({
      event,
      rfidUid: null,
      method: actor || 'system'
    });
  }

  if (abnormal) {
    const alert = await alertService.createAlert({
      type: 'door',
      level: 'WARNING',
      message: `Abnormal door access: ${eventType} by ${actor || 'unknown'}`
    });
    await pushService.sendToAll('🚪 Door Alert!', alert.message);
  }
}

async function checkOfflineDevices() {
  const now = Date.now();
  for (const [deviceId, lastSeen] of deviceLastSeen) {
    if (now - lastSeen > OFFLINE_THRESHOLD) {
      await pushService.sendToAll('📡 Device Offline', `ESP32 ${deviceId} is offline`);
      deviceLastSeen.delete(deviceId);
    }
  }
}

function publish(topic, message) {
  if (client) {
    console.log(`MQTT PUBLISH [${topic}]:`, message);
    client.publish(topic, JSON.stringify(message));
  }
}

module.exports = { connect, publish };
