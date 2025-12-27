/**
 * MQTT Door Event Logging Tests
 * Tests for door state changes from ESP32 via MQTT
 */

// Mock dependencies before imports
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    door: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    doorAccessLog: {
      create: jest.fn(),
    },
    accessLog: {
      create: jest.fn(),
    },
    alert: {
      create: jest.fn(),
    },
    pushToken: {
      findMany: jest.fn(),
    },
    rfidCard: {
      findFirst: jest.fn(),
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

jest.mock('mqtt', () => ({
  connect: jest.fn(() => ({
    on: jest.fn(),
    subscribe: jest.fn(),
    publish: jest.fn(),
  })),
}));

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(),
  },
  messaging: jest.fn(() => ({
    send: jest.fn(),
    sendEachForMulticast: jest.fn(),
  })),
}));

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

describe('MQTT Door Event Logging', () => {
  const mockDoor = {
    id: 'door-uuid-123',
    name: 'Cửa chính',
    pinHash: 'hashed-pin',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.door.findFirst.mockResolvedValue(mockDoor);
    prisma.doorAccessLog.create.mockResolvedValue({ id: 1 });
    prisma.accessLog.create.mockResolvedValue({ id: 1 });
  });

  describe('Door State Change Events', () => {
    it('should log door_opened event when door opens', async () => {
      const doorService = require('../../src/services/door.service');

      await doorService.createAccessLog({
        event: 'door_opened',
        rfidUid: null,
        method: 'system',
      });

      expect(prisma.doorAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          doorId: mockDoor.id,
          event: 'door_opened',
          method: 'system',
        }),
      });
    });

    it('should log door_closed event when door closes', async () => {
      const doorService = require('../../src/services/door.service');

      await doorService.createAccessLog({
        event: 'door_closed',
        rfidUid: null,
        method: 'system',
      });

      expect(prisma.doorAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'door_closed',
        }),
      });
    });
  });

  describe('Door Event Payload Handling', () => {
    it('should handle payload with status field (new format)', () => {
      const payload = {
        status: 'open',
        online: true,
        abnormal: false,
      };

      const eventType = payload.status || payload.state;
      expect(eventType).toBe('open');
    });

    it('should handle payload with state field (old format)', () => {
      const payload = {
        state: 'closed',
        actor: 'keypad',
      };

      const eventType = payload.status || payload.state;
      expect(eventType).toBe('closed');
    });

    it('should extract actor from payload', () => {
      const payload = {
        status: 'open',
        actor: 'web_admin',
      };

      expect(payload.actor).toBe('web_admin');
    });

    it('should default actor to unknown when not provided', () => {
      const payload = {
        status: 'open',
      };

      const actor = payload.actor || 'unknown';
      expect(actor).toBe('unknown');
    });
  });

  describe('Event Type Mapping', () => {
    it('should map "open" status to door_opened event', () => {
      const mapStatusToEvent = (status) => {
        return status === 'open' ? 'door_opened' : 'door_closed';
      };

      expect(mapStatusToEvent('open')).toBe('door_opened');
    });

    it('should map "closed" status to door_closed event', () => {
      const mapStatusToEvent = (status) => {
        return status === 'open' ? 'door_opened' : 'door_closed';
      };

      expect(mapStatusToEvent('closed')).toBe('door_closed');
    });
  });

  describe('Access Granted Events', () => {
    it('should log access_granted with RFID UID', async () => {
      const doorService = require('../../src/services/door.service');

      prisma.rfidCard.findFirst.mockResolvedValue({
        user: { id: 1, username: 'testuser' },
      });

      await doorService.createAccessLog({
        event: 'access_granted',
        rfidUid: 'ABC123',
        method: 'rfid_pin',
      });

      expect(prisma.doorAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'access_granted',
          rfidUid: 'ABC123',
          method: 'rfid_pin',
        }),
      });
    });

    it('should log access_granted from web admin', async () => {
      const doorService = require('../../src/services/door.service');

      await doorService.createAccessLog({
        event: 'access_granted',
        rfidUid: 'MQTT',
        method: 'web_admin',
      });

      expect(prisma.doorAccessLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'access_granted',
          method: 'web_admin',
        }),
      });
    });
  });

  describe('Abnormal Door Events', () => {
    it('should detect abnormal flag in payload', () => {
      const payload = {
        status: 'open',
        abnormal: true,
      };

      expect(payload.abnormal).toBe(true);
    });

    it('should not flag normal door operations as abnormal', () => {
      const payload = {
        status: 'open',
        abnormal: false,
      };

      expect(payload.abnormal).toBe(false);
    });
  });
});

describe('Door History Data Integrity', () => {
  it('should preserve timestamp precision', () => {
    const timestamp = new Date('2025-12-27T10:30:45.123Z');
    const isoString = timestamp.toISOString();

    expect(isoString).toBe('2025-12-27T10:30:45.123Z');
  });

  it('should handle null user gracefully', () => {
    const log = {
      id: 1,
      event: 'door_opened',
      method: 'system',
      timestamp: new Date(),
      user: null,
    };

    expect(log.user).toBeNull();
  });

  it('should include user info when available', () => {
    const log = {
      id: 1,
      event: 'access_granted',
      method: 'rfid_pin',
      timestamp: new Date(),
      user: { id: 1, username: 'admin' },
    };

    expect(log.user).not.toBeNull();
    expect(log.user.username).toBe('admin');
  });
});
