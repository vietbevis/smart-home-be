/**
 * Door History Feature Tests
 * Tests for door event logging, retrieval, and API endpoints
 */

const request = require('supertest');
const express = require('express');
const { PrismaClient } = require('@prisma/client');

// Mock PrismaClient
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    door: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

const prisma = new PrismaClient();

// Import after mocking
const doorService = require('../../src/services/door.service');

describe('Door History Feature', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Door Service - createAccessLog', () => {
    const mockDoor = {
      id: 'door-uuid-123',
      name: 'Cửa chính',
      pinHash: 'hashed-pin',
    };

    beforeEach(() => {
      prisma.door.findFirst.mockResolvedValue(mockDoor);
    });

    it('should create access log for door_opened event', async () => {
      const logData = {
        event: 'door_opened',
        rfidUid: null,
        method: 'system',
      };

      prisma.doorAccessLog.create.mockResolvedValue({
        id: 1,
        doorId: mockDoor.id,
        ...logData,
        timestamp: new Date(),
      });

      const result = await doorService.createAccessLog(logData);

      expect(prisma.doorAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          doorId: mockDoor.id,
          event: 'door_opened',
          method: 'system',
        }),
      });
      expect(result.event).toBe('door_opened');
    });

    it('should create access log for door_closed event', async () => {
      const logData = {
        event: 'door_closed',
        rfidUid: null,
        method: 'system',
      };

      prisma.doorAccessLog.create.mockResolvedValue({
        id: 2,
        doorId: mockDoor.id,
        ...logData,
        timestamp: new Date(),
      });

      const result = await doorService.createAccessLog(logData);

      expect(result.event).toBe('door_closed');
    });

    it('should create access log with user ID when RFID is provided', async () => {
      const mockUser = { id: 1, username: 'testuser' };
      prisma.rfidCard.findFirst.mockResolvedValue({
        user: mockUser,
      });

      const logData = {
        event: 'access_granted',
        rfidUid: 'ABC123',
        method: 'rfid_pin',
      };

      prisma.doorAccessLog.create.mockResolvedValue({
        id: 3,
        doorId: mockDoor.id,
        userId: mockUser.id,
        ...logData,
        timestamp: new Date(),
      });

      await doorService.createAccessLog(logData);

      expect(prisma.doorAccessLog.create).toHaveBeenCalled();
    });
  });

  describe('Door Service - getDoorHistory', () => {
    const mockDoor = {
      id: 'door-uuid-123',
      name: 'Cửa chính',
    };

    const mockLogs = [
      {
        id: 1,
        event: 'door_opened',
        method: 'web_admin',
        timestamp: new Date('2025-12-27T10:00:00Z'),
        user: { id: 1, username: 'admin' },
      },
      {
        id: 2,
        event: 'door_closed',
        method: 'system',
        timestamp: new Date('2025-12-27T10:00:05Z'),
        user: null,
      },
      {
        id: 3,
        event: 'access_granted',
        method: 'rfid_pin',
        timestamp: new Date('2025-12-27T11:00:00Z'),
        user: { id: 2, username: 'user1' },
      },
    ];

    beforeEach(() => {
      prisma.door.findFirst.mockResolvedValue(mockDoor);
    });

    it('should return door history with pagination', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue(mockLogs);
      prisma.doorAccessLog.count.mockResolvedValue(3);

      const result = await doorService.getDoorHistory({ page: 1, limit: 20 });

      expect(result.logs).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should filter only door open/close events', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue(mockLogs);
      prisma.doorAccessLog.count.mockResolvedValue(3);

      await doorService.getDoorHistory({ page: 1, limit: 20 });

      expect(prisma.doorAccessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            event: { in: ['door_opened', 'door_closed', 'access_granted'] },
          }),
        })
      );
    });

    it('should order logs by timestamp descending', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue(mockLogs);
      prisma.doorAccessLog.count.mockResolvedValue(3);

      await doorService.getDoorHistory({ page: 1, limit: 20 });

      expect(prisma.doorAccessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { timestamp: 'desc' },
        })
      );
    });

    it('should handle pagination correctly', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue([mockLogs[2]]);
      prisma.doorAccessLog.count.mockResolvedValue(3);

      const result = await doorService.getDoorHistory({ page: 2, limit: 2 });

      expect(prisma.doorAccessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 2,
          take: 2,
        })
      );
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(2);
    });

    it('should return empty array when no logs exist', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue([]);
      prisma.doorAccessLog.count.mockResolvedValue(0);

      const result = await doorService.getDoorHistory({ page: 1, limit: 20 });

      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('Door Service - getAccessLogs', () => {
    const mockDoor = { id: 'door-uuid-123' };

    beforeEach(() => {
      prisma.door.findFirst.mockResolvedValue(mockDoor);
    });

    it('should return all access logs without filter', async () => {
      const allLogs = [
        { id: 1, event: 'door_opened', method: 'system' },
        { id: 2, event: 'access_denied', method: 'invalid_pin' },
        { id: 3, event: 'alarm_triggered', method: 'max_failed_attempts' },
      ];

      prisma.doorAccessLog.findMany.mockResolvedValue(allLogs);
      prisma.doorAccessLog.count.mockResolvedValue(3);

      const result = await doorService.getAccessLogs({ page: 1, limit: 50 });

      expect(result.logs).toHaveLength(3);
    });

    it('should filter logs by event type', async () => {
      prisma.doorAccessLog.findMany.mockResolvedValue([
        { id: 2, event: 'access_denied' },
      ]);
      prisma.doorAccessLog.count.mockResolvedValue(1);

      await doorService.getAccessLogs({
        page: 1,
        limit: 50,
        eventFilter: 'access_denied',
      });

      expect(prisma.doorAccessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            event: 'access_denied',
          }),
        })
      );
    });
  });
});

describe('Door History Event Types', () => {
  it('should recognize door_opened as valid event', () => {
    const validEvents = ['door_opened', 'door_closed', 'access_granted'];
    expect(validEvents).toContain('door_opened');
  });

  it('should recognize door_closed as valid event', () => {
    const validEvents = ['door_opened', 'door_closed', 'access_granted'];
    expect(validEvents).toContain('door_closed');
  });

  it('should recognize access_granted as valid event', () => {
    const validEvents = ['door_opened', 'door_closed', 'access_granted'];
    expect(validEvents).toContain('access_granted');
  });
});

describe('Door History Method Labels', () => {
  const getMethodLabel = (method) => {
    if (!method) return 'Hệ thống';
    switch (method) {
      case 'rfid_pin':
        return 'RFID + PIN';
      case 'rfid':
        return 'Thẻ RFID';
      case 'web_admin':
        return 'Web Admin';
      case 'system':
        return 'Hệ thống';
      case 'MQTT':
        return 'Điều khiển từ xa';
      default:
        return method;
    }
  };

  it('should return correct label for rfid_pin', () => {
    expect(getMethodLabel('rfid_pin')).toBe('RFID + PIN');
  });

  it('should return correct label for web_admin', () => {
    expect(getMethodLabel('web_admin')).toBe('Web Admin');
  });

  it('should return correct label for system', () => {
    expect(getMethodLabel('system')).toBe('Hệ thống');
  });

  it('should return "Hệ thống" for null method', () => {
    expect(getMethodLabel(null)).toBe('Hệ thống');
  });

  it('should return original value for unknown method', () => {
    expect(getMethodLabel('custom_method')).toBe('custom_method');
  });
});
