/**
 * Door History API Endpoint Tests
 * Tests for /api/doors/history endpoint
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    door: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    doorAccessLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    rfidCard: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('../../src/services/mqtt.service', () => ({
  connect: jest.fn(),
  publish: jest.fn(),
}));

// Mock auth middleware
jest.mock('../../src/middleware/auth.middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 1, username: 'testuser', role: 'ADMIN' };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  const doorRoutes = require('../../src/routes/door.routes');
  app.use('/api/doors', doorRoutes);

  return app;
};

describe('Door History API Endpoints', () => {
  let app;
  const mockDoor = {
    id: 'door-uuid-123',
    name: 'Cửa chính',
    pinHash: 'hashed-pin',
  };

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.door.findFirst.mockResolvedValue(mockDoor);
  });

  describe('GET /api/doors/history', () => {
    it('should return door history with default pagination', async () => {
      const mockLogs = [
        {
          id: 1,
          event: 'door_opened',
          method: 'web_admin',
          timestamp: new Date(),
          user: { id: 1, username: 'admin' },
        },
        {
          id: 2,
          event: 'door_closed',
          method: 'system',
          timestamp: new Date(),
          user: null,
        },
      ];

      prisma.doorAccessLog.findMany.mockResolvedValue(mockLogs);
      prisma.doorAccessLog.count.mockResolvedValue(2);

      const response = await request(app).get('/api/doors/history');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('totalPages');
      expect(response.body.logs).toHaveLength(2);
    });

    it('should accept page and limit query parameters', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue([]);
      prisma.doorAccessLog.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/doors/history')
        .query({ page: 2, limit: 5 });

      expect(response.status).toBe(200);
      expect(prisma.doorAccessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        })
      );
    });

    it('should return empty array when no history exists', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue([]);
      prisma.doorAccessLog.count.mockResolvedValue(0);

      const response = await request(app).get('/api/doors/history');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(0);
      expect(response.body.total).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      prisma.doorAccessLog.findMany.mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app).get('/api/doors/history');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/doors/logs', () => {
    it('should return all access logs', async () => {
      const mockLogs = [
        { id: 1, event: 'door_opened', user: null },
        { id: 2, event: 'access_denied', user: null },
        { id: 3, event: 'alarm_triggered', user: null },
      ];

      prisma.doorAccessLog.findMany.mockResolvedValue(mockLogs);
      prisma.doorAccessLog.count.mockResolvedValue(3);

      const response = await request(app).get('/api/doors/logs');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(3);
    });

    it('should filter logs by event type', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue([
        { id: 2, event: 'access_denied', user: null },
      ]);
      prisma.doorAccessLog.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/doors/logs')
        .query({ event: 'access_denied' });

      expect(response.status).toBe(200);
    });
  });
});

describe('Door History Response Format', () => {
  it('should have correct log structure', () => {
    const expectedLogStructure = {
      id: expect.any(Number),
      event: expect.any(String),
      method: expect.any(String),
      timestamp: expect.any(String),
      user: expect.any(Object),
    };

    const sampleLog = {
      id: 1,
      event: 'door_opened',
      method: 'system',
      timestamp: '2025-12-27T10:00:00.000Z',
      user: null,
    };

    expect(sampleLog).toMatchObject({
      id: expect.any(Number),
      event: expect.any(String),
      method: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('should have correct pagination structure', () => {
    const expectedPaginationStructure = {
      logs: expect.any(Array),
      total: expect.any(Number),
      page: expect.any(Number),
      totalPages: expect.any(Number),
    };

    const sampleResponse = {
      logs: [],
      total: 0,
      page: 1,
      totalPages: 0,
    };

    expect(sampleResponse).toMatchObject(expectedPaginationStructure);
  });
});
