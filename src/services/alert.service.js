const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// MQTT service will be injected to avoid circular dependency
let mqttPublish = null;

function setMqttPublish(publishFn) {
  mqttPublish = publishFn;
}

async function createAlert({ type, level, message }) {
  const alert = await prisma.alert.create({
    data: { type, level, message },
    include: { acknowledgedBy: { select: { id: true, username: true } } }
  });

  // Publish new alert to MQTT for real-time updates
  if (mqttPublish) {
    mqttPublish('home/alert/new', {
      id: alert.id,
      type: alert.type,
      level: alert.level,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
      acknowledgedBy: null
    });
    console.log('📢 Alert published to MQTT:', alert.message);
  }

  return alert;
}

async function getAlerts({ page = 1, limit = 20, type, level }) {
  const where = {};
  if (type) where.type = type;
  if (level) where.level = level;

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { acknowledgedBy: { select: { id: true, username: true } } }
    }),
    prisma.alert.count({ where })
  ]);

  return { alerts, total, page, totalPages: Math.ceil(total / limit) };
}

async function acknowledgeAlert(alertId, userId) {
  return prisma.alert.update({
    where: { id: alertId },
    data: { acknowledgedById: userId }
  });
}

async function createAccessLog({ eventType, actor }) {
  return prisma.accessLog.create({
    data: { eventType, actor }
  });
}

async function getAccessLogs({ page = 1, limit = 20 }) {
  const [logs, total] = await Promise.all([
    prisma.accessLog.findMany({
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.accessLog.count()
  ]);

  return { logs, total, page, totalPages: Math.ceil(total / limit) };
}

module.exports = { createAlert, getAlerts, acknowledgeAlert, createAccessLog, getAccessLogs, setMqttPublish };
