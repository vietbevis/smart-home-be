const { PrismaClient } = require('@prisma/client');
const { adapter } = require('../../prisma/adapter');

// Prisma 7: Connection URL is in prisma.config.ts
// PrismaClient requires an adapter for database connections
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
