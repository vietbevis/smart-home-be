// Test database connection directly
require('dotenv').config();

async function testConnection() {
  console.log('Testing database connection...');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);

  // Test 1: Direct mysql2 connection
  const mysql = require('mysql2/promise');
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [rows] = await conn.execute('SELECT 1 as test');
    console.log('✅ Direct mysql2 connection OK:', rows);
    await conn.end();
  } catch (err) {
    console.error('❌ Direct mysql2 failed:', err.message);
  }

  // Test 2: Pool connection
  try {
    const pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 5,
    });
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT 1 as test');
    console.log('✅ Pool connection OK:', rows);
    conn.release();
    await pool.end();
  } catch (err) {
    console.error('❌ Pool connection failed:', err.message);
  }

  // Test 3: Prisma connection
  try {
    const prisma = require('./src/lib/prisma');
    await prisma.$connect();
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Prisma connection OK:', result);
    await prisma.$disconnect();
  } catch (err) {
    console.error('❌ Prisma connection failed:', err.message);
  }

  process.exit(0);
}

testConnection();
