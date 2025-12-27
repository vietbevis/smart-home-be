// Prisma 7 MySQL Adapter
require('dotenv').config();
const mysql = require('mysql2/promise');

// Validate DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Parse DATABASE_URL into connection config
function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('DATABASE_URL must be a valid string');
  }

  try {
    // Try using URL constructor for better parsing
    const dbUrl = new URL(url);

    const config = {
      host: dbUrl.hostname,
      port: dbUrl.port ? parseInt(dbUrl.port, 10) : 3306,
      user: dbUrl.username || undefined,
      password: dbUrl.password || undefined,
      database: dbUrl.pathname ? dbUrl.pathname.slice(1) : undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };

    // Remove undefined values
    Object.keys(config).forEach(key => {
      if (config[key] === undefined) {
        delete config[key];
      }
    });

    return config;
  } catch (error) {
    // If URL parsing fails, try regex fallback
    console.warn('URL parsing failed, trying regex fallback:', error.message);

    // Parse mysql://user:password@host:port/database format
    const urlPattern = /^mysql:\/\/(?:([^:]+):([^@]+)@)?([^:]+)(?::(\d+))?(?:\/(.+))?$/;
    const match = url.match(urlPattern);

    if (match) {
      return {
        host: match[3],
        port: match[4] ? parseInt(match[4], 10) : 3306,
        user: match[1] || undefined,
        password: match[2] || undefined,
        database: match[5] || undefined,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      };
    }

    throw new Error(`Invalid DATABASE_URL format: ${url}`);
  }
}

// Try to use official adapter if available, otherwise use custom implementation
let adapter;

try {
  // Try to use official @prisma/adapter-mariadb if installed
  const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
  const config = parseDatabaseUrl(process.env.DATABASE_URL);
  const pool = mysql.createPool(config);
  adapter = new PrismaMariaDb(pool);
} catch (error) {
  // Fallback to custom adapter implementation
  console.log('Using custom MySQL adapter (official adapter not available)');

  // Create MySQL connection pool from DATABASE_URL
  const config = parseDatabaseUrl(process.env.DATABASE_URL);
  const pool = mysql.createPool(config);

  // Custom adapter class that implements Prisma 7's DriverAdapter interface
  class MySQLAdapter {
    constructor(connectionPool) {
      this.pool = connectionPool;
      this.provider = 'mysql';
      this.adapterName = 'mysql2-custom';
    }

    async query(text, values) {
      const [rows] = await this.pool.execute(text, values);
      return rows;
    }

    async execute(text, values) {
      const [result] = await this.pool.execute(text, values);
      return result;
    }

    async transaction(callback) {
      const conn = await this.pool.getConnection();
      await conn.beginTransaction();
      try {
        const result = await callback({
          query: async (text, values) => {
            const [rows] = await conn.execute(text, values);
            return rows;
          },
          execute: async (text, values) => {
            const [result] = await conn.execute(text, values);
            return result;
          },
        });
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    }
  }

  adapter = new MySQLAdapter(pool);
}

module.exports = { adapter };

