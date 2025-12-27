require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const mqttService = require('./services/mqtt.service');
const authRoutes = require('./routes/auth.routes');
const alertRoutes = require('./routes/alert.routes');
const pushTokenRoutes = require('./routes/pushToken.routes');
const pushRoutes = require('./routes/push.routes');
const accessLogRoutes = require('./routes/accessLog.routes');
const doorRoutes = require('./routes/door.routes');

const app = express();

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
  try {
    await prisma.$connect();
    console.log('Database connected');
  } catch (error) {
    console.error('Failed to connect to database:', error.message);
    if (error.message.includes('pool timeout')) {
      console.error('\nPossible causes:');
      console.error('1. Database server is not running or not reachable');
      console.error('2. DATABASE_URL is incorrect (check host, port, credentials)');
      console.error('3. Network/firewall blocking the connection');
      console.error('4. Database does not exist or user lacks permissions');
      console.error('\nCheck your DATABASE_URL environment variable');
    }
    process.exit(1);
  }

  mqttService.connect();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error('Application error:', error);
  process.exit(1);
});

module.exports = { prisma };
