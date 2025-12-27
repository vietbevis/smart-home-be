// Prisma 7 MySQL Adapter
require('dotenv').config();
const mysql = require('mysql2/promise');

// Try to use official adapter if available, otherwise use custom implementation
let adapter;

try {
  // Try to use official @prisma/adapter-mariadb if installed
  const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
  const pool = mysql.createPool(process.env.DATABASE_URL);
  adapter = new PrismaMariaDb(pool);
} catch (error) {
  // Fallback to custom adapter implementation
  console.log('Using custom MySQL adapter (official adapter not available)');
  
  // Create MySQL connection pool from DATABASE_URL
  const pool = mysql.createPool(process.env.DATABASE_URL);

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

