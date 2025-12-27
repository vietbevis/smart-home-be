require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const mqttService = require('./services/mqtt.service');
const authRoutes = require('./routes/auth.routes');
const alertRoutes = require('./routes/alert.routes');
const pushTokenRoutes = require('./routes/pushToken.routes');
const pushRoutes = require('./routes/push.routes');
const accessLogRoutes = require('./routes/accessLog.routes');
const doorRoutes = require('./routes/door.routes');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/push-tokens', pushTokenRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/access-logs', accessLogRoutes);
app.use('/api/doors', doorRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;

async function main() {
  await prisma.$connect();
  console.log('Database connected');
  
  mqttService.connect();
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch(console.error);

module.exports = { prisma };
