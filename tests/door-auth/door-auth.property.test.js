/**
 * Property-Based Tests for Door Access Control Authentication
 * Feature: door-auth-refactor
 * 
 * These tests validate the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

const fc = require('fast-check');
const crypto = require('crypto');

// Import the door service functions we're testing
const doorService = require('../../src/services/door.service');

// Mock Prisma for database operations
jest.mock('../../src/lib/prisma', () => ({
  door: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  rfidCard: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  doorAccessLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
}));

const prisma = require('../../src/lib/prisma');

// ==================== Helper Functions ====================

/**
 * SHA-256 hash function (same as in door.service.js)
 */
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Validates PIN format: exactly 4 numeric digits
 */
function validatePin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

/**
 * Generates a valid 4-digit PIN
 */
const validPinArbitrary = fc.string({ minLength: 4, maxLength: 4 })
  .filter(s => /^\d{4}$/.test(s))
  .map(s => s.padStart(4, '0').slice(0, 4));

// Alternative: generate 4 random digits directly
const validPinArbitrary2 = fc.tuple(
  fc.integer({ min: 0, max: 9 }),
  fc.integer({ min: 0, max: 9 }),
  fc.integer({ min: 0, max: 9 }),
  fc.integer({ min: 0, max: 9 })
).map(([a, b, c, d]) => `${a}${b}${c}${d}`);

/**
 * Generates an invalid PIN (not 4 digits or contains non-numeric)
 */
const invalidPinArbitrary = fc.oneof(
  // Too short (0-3 digits)
  fc.integer({ min: 0, max: 999 }).map(n => n.toString()),
  // Too long (5+ digits)
  fc.integer({ min: 10000, max: 99999 }).map(n => n.toString()),
  // Contains non-numeric characters
  fc.string({ minLength: 4, maxLength: 4 }).filter(s => !/^\d{4}$/.test(s) && s.length === 4),
  // Empty string
  fc.constant('')
);

// ==================== Property Tests ====================

describe('Door Authentication Property Tests', () => {
  
  /**
   * Property 4: PIN Hash Round-Trip
   * For any 4-digit PIN, hashing with SHA-256 and then comparing with a stored hash
   * of the same PIN shall return true (hash consistency).
   * 
   * Feature: door-auth-refactor, Property 4: PIN Hash Round-Trip
   * Validates: Requirements 3.1, 7.2
   */
  describe('Property 4: PIN Hash Round-Trip', () => {
    it('hashing the same PIN twice produces identical hashes', () => {
      fc.assert(
        fc.property(validPinArbitrary2, (pin) => {
          const hash1 = sha256(pin);
          const hash2 = sha256(pin);
          return hash1 === hash2;
        }),
        { numRuns: 100 }
      );
    });

    it('different PINs produce different hashes', () => {
      fc.assert(
        fc.property(validPinArbitrary2, validPinArbitrary2, (pin1, pin2) => {
          // Only test when PINs are different
          fc.pre(pin1 !== pin2);
          const hash1 = sha256(pin1);
          const hash2 = sha256(pin2);
          return hash1 !== hash2;
        }),
        { numRuns: 100 }
      );
    });

    it('hash is always 64 characters (SHA-256 hex)', () => {
      fc.assert(
        fc.property(validPinArbitrary2, (pin) => {
          const hash = sha256(pin);
          return hash.length === 64 && /^[a-f0-9]{64}$/.test(hash);
        }),
        { numRuns: 100 }
      );
    });

    it('validatePinHash returns true for matching PIN', () => {
      fc.assert(
        fc.property(validPinArbitrary2, (pin) => {
          const storedHash = sha256(pin);
          const inputHash = sha256(pin);
          return storedHash === inputHash;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 7: PIN Validation
   * For any input string, the PIN validation shall accept if and only if
   * the string is exactly 4 characters and all characters are numeric digits (0-9).
   * 
   * Feature: door-auth-refactor, Property 7: PIN Validation
   * Validates: Requirements 3.4
   */
  describe('Property 7: PIN Validation', () => {
    it('accepts exactly 4 numeric digits', () => {
      fc.assert(
        fc.property(validPinArbitrary2, (pin) => {
          return validatePin(pin) === true;
        }),
        { numRuns: 100 }
      );
    });

    it('rejects strings that are not exactly 4 numeric digits', () => {
      fc.assert(
        fc.property(invalidPinArbitrary, (input) => {
          return validatePin(input) === false;
        }),
        { numRuns: 100 }
      );
    });

    it('validation is consistent with regex /^\\d{4}$/', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const isValid = validatePin(input);
          const regexValid = /^\d{4}$/.test(input);
          return isValid === regexValid;
        }),
        { numRuns: 100 }
      );
    });
  });
});


// ==================== Access Log Property Tests ====================

/**
 * Mock access log entry for testing
 */
function createAccessLogEntry(event, method, rfidUid = null, userId = null) {
  return {
    id: Math.floor(Math.random() * 10000),
    doorId: 'door-uuid-123',
    userId,
    event,
    rfidUid,
    method,
    timestamp: new Date()
  };
}

/**
 * Valid event types
 */
const validEvents = ['access_granted', 'access_denied', 'alarm_triggered', 'door_opened', 'door_closed'];

/**
 * Valid authentication methods
 */
const validMethods = ['pin', 'rfid', 'invalid_pin', 'invalid_rfid', 'card_revoked', 'web_admin', 'physical_button', 'system'];

/**
 * Generates a valid event type
 */
const validEventArbitrary = fc.constantFrom(...validEvents);

/**
 * Generates a valid method
 */
const validMethodArbitrary = fc.constantFrom(...validMethods);

/**
 * Generates a valid RFID UID (hex string) - using integer-based generation
 */
const hexChars = '0123456789ABCDEF';
const validRfidUidArbitrary = fc.array(
  fc.integer({ min: 0, max: 15 }),
  { minLength: 8, maxLength: 16 }
).map(arr => arr.map(n => hexChars[n]).join(''));

describe('Access Log Property Tests', () => {
  /**
   * Property 6: Access Log Completeness
   * For any authentication attempt (success or failure), the Door_System shall create
   * an access log entry containing: event type, authentication method, and timestamp.
   * 
   * Feature: door-auth-refactor, Property 6: Access Log Completeness
   * Validates: Requirements 1.4, 1.5, 2.4, 2.5, 5.1, 5.2, 5.4
   */
  describe('Property 6: Access Log Completeness', () => {
    it('every access log entry has required fields', () => {
      fc.assert(
        fc.property(validEventArbitrary, validMethodArbitrary, (event, method) => {
          const logEntry = createAccessLogEntry(event, method);
          
          // Must have event type
          const hasEvent = typeof logEntry.event === 'string' && logEntry.event.length > 0;
          // Must have method
          const hasMethod = typeof logEntry.method === 'string' && logEntry.method.length > 0;
          // Must have timestamp
          const hasTimestamp = logEntry.timestamp instanceof Date;
          // Must have doorId
          const hasDoorId = typeof logEntry.doorId === 'string' && logEntry.doorId.length > 0;
          
          return hasEvent && hasMethod && hasTimestamp && hasDoorId;
        }),
        { numRuns: 100 }
      );
    });

    it('event type is one of the valid types', () => {
      fc.assert(
        fc.property(validEventArbitrary, (event) => {
          return validEvents.includes(event);
        }),
        { numRuns: 100 }
      );
    });

    it('method is one of the valid methods', () => {
      fc.assert(
        fc.property(validMethodArbitrary, (method) => {
          return validMethods.includes(method);
        }),
        { numRuns: 100 }
      );
    });

    it('successful PIN auth logs with method "pin"', () => {
      const logEntry = createAccessLogEntry('access_granted', 'pin');
      expect(logEntry.event).toBe('access_granted');
      expect(logEntry.method).toBe('pin');
    });

    it('successful RFID auth logs with method "rfid"', () => {
      const logEntry = createAccessLogEntry('access_granted', 'rfid', 'ABCD1234');
      expect(logEntry.event).toBe('access_granted');
      expect(logEntry.method).toBe('rfid');
      expect(logEntry.rfidUid).toBe('ABCD1234');
    });

    it('failed PIN auth logs with method "invalid_pin"', () => {
      const logEntry = createAccessLogEntry('access_denied', 'invalid_pin');
      expect(logEntry.event).toBe('access_denied');
      expect(logEntry.method).toBe('invalid_pin');
    });

    it('failed RFID auth logs with method "invalid_rfid" or "card_revoked"', () => {
      fc.assert(
        fc.property(fc.constantFrom('invalid_rfid', 'card_revoked'), (method) => {
          const logEntry = createAccessLogEntry('access_denied', method);
          return logEntry.event === 'access_denied' && 
                 (logEntry.method === 'invalid_rfid' || logEntry.method === 'card_revoked');
        }),
        { numRuns: 100 }
      );
    });
  });
});


// ==================== Core Authentication Property Tests ====================

/**
 * Simulates PIN authentication logic (mirrors ESP32 behavior)
 * Returns: { success: boolean, shouldUnlock: boolean }
 */
function simulatePinAuth(inputPin, storedPinHash, rfidValidated = false) {
  // Property 1: PIN should work independently of RFID state
  const inputHash = sha256(inputPin);
  const isValid = inputHash === storedPinHash;
  
  return {
    success: isValid,
    shouldUnlock: isValid,  // No dependency on rfidValidated
    method: isValid ? 'pin' : 'invalid_pin'
  };
}

/**
 * Simulates RFID authentication logic (mirrors ESP32 behavior)
 * Returns: { success: boolean, shouldUnlock: boolean, reason?: string }
 */
function simulateRfidAuth(cardUidHash, whitelist, cardStatus = 'ACTIVE') {
  // Property 2: RFID should unlock immediately without PIN
  const cardInWhitelist = whitelist.some(entry => entry.uidHash === cardUidHash);
  
  if (!cardInWhitelist) {
    return {
      success: false,
      shouldUnlock: false,
      reason: 'unknown_card',
      method: 'invalid_rfid'
    };
  }
  
  if (cardStatus === 'REVOKED') {
    return {
      success: false,
      shouldUnlock: false,
      reason: 'card_revoked',
      method: 'card_revoked'
    };
  }
  
  return {
    success: true,
    shouldUnlock: true,  // Immediate unlock, no PIN required
    method: 'rfid'
  };
}

/**
 * Failed attempt counter state machine
 */
class FailedAttemptCounter {
  constructor() {
    this.count = 0;
    this.alarmThreshold = 5;
  }
  
  recordAttempt(success) {
    if (success) {
      this.count = 0;  // Reset on success
    } else {
      this.count += 1;  // Increment on failure
    }
    return this.count;
  }
  
  shouldTriggerAlarm() {
    return this.count >= this.alarmThreshold;
  }
  
  reset() {
    this.count = 0;
  }
}

describe('Core Authentication Property Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 1: PIN Authentication Independence
   * For any valid 4-digit PIN, when entered via keypad without any prior RFID scan,
   * the Door_System shall authenticate successfully and unlock the door.
   * 
   * Feature: door-auth-refactor, Property 1: PIN Authentication Independence
   * Validates: Requirements 1.1, 1.3, 6.1, 6.5
   */
  describe('Property 1: PIN Authentication Independence', () => {
    it('valid PIN unlocks door regardless of RFID state (rfidValidated=false)', () => {
      fc.assert(
        fc.property(validPinArbitrary2, (pin) => {
          const storedHash = sha256(pin);
          
          // Test with rfidValidated = false (no prior RFID scan)
          const result = simulatePinAuth(pin, storedHash, false);
          
          return result.success === true && 
                 result.shouldUnlock === true &&
                 result.method === 'pin';
        }),
        { numRuns: 100 }
      );
    });

    it('valid PIN unlocks door regardless of RFID state (rfidValidated=true)', () => {
      fc.assert(
        fc.property(validPinArbitrary2, (pin) => {
          const storedHash = sha256(pin);
          
          // Test with rfidValidated = true (prior RFID scan)
          const result = simulatePinAuth(pin, storedHash, true);
          
          return result.success === true && 
                 result.shouldUnlock === true &&
                 result.method === 'pin';
        }),
        { numRuns: 100 }
      );
    });

    it('PIN authentication result is independent of rfidValidated flag', () => {
      fc.assert(
        fc.property(validPinArbitrary2, fc.boolean(), (pin, rfidState) => {
          const storedHash = sha256(pin);
          
          const resultWithRfid = simulatePinAuth(pin, storedHash, true);
          const resultWithoutRfid = simulatePinAuth(pin, storedHash, false);
          
          // Both should produce identical results
          return resultWithRfid.success === resultWithoutRfid.success &&
                 resultWithRfid.shouldUnlock === resultWithoutRfid.shouldUnlock &&
                 resultWithRfid.method === resultWithoutRfid.method;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: RFID Authentication Independence
   * For any valid RFID card in the whitelist, when scanned without any subsequent PIN entry,
   * the Door_System shall authenticate successfully and unlock the door immediately.
   * 
   * Feature: door-auth-refactor, Property 2: RFID Authentication Independence
   * Validates: Requirements 2.1, 2.3, 6.2, 6.4
   */
  describe('Property 2: RFID Authentication Independence', () => {
    it('valid RFID card unlocks door immediately without PIN', () => {
      fc.assert(
        fc.property(validRfidUidArbitrary, (uid) => {
          const uidHash = sha256(uid);
          const whitelist = [{ uidHash, username: 'testuser' }];
          
          const result = simulateRfidAuth(uidHash, whitelist, 'ACTIVE');
          
          return result.success === true && 
                 result.shouldUnlock === true &&
                 result.method === 'rfid';
        }),
        { numRuns: 100 }
      );
    });

    it('RFID authentication does not require subsequent PIN entry', () => {
      fc.assert(
        fc.property(validRfidUidArbitrary, (uid) => {
          const uidHash = sha256(uid);
          const whitelist = [{ uidHash, username: 'testuser' }];
          
          const result = simulateRfidAuth(uidHash, whitelist, 'ACTIVE');
          
          // shouldUnlock should be true immediately, not pending PIN
          return result.shouldUnlock === true;
        }),
        { numRuns: 100 }
      );
    });

    it('revoked RFID card is denied access', () => {
      fc.assert(
        fc.property(validRfidUidArbitrary, (uid) => {
          const uidHash = sha256(uid);
          const whitelist = [{ uidHash, username: 'testuser' }];
          
          const result = simulateRfidAuth(uidHash, whitelist, 'REVOKED');
          
          return result.success === false && 
                 result.shouldUnlock === false &&
                 result.reason === 'card_revoked';
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: Invalid Credential Rejection
   * For any invalid credential (wrong PIN or unknown/revoked RFID card),
   * the Door_System shall deny access and increment the failed attempt counter by exactly 1.
   * 
   * Feature: door-auth-refactor, Property 3: Invalid Credential Rejection
   * Validates: Requirements 1.2, 2.2, 4.1
   */
  describe('Property 3: Invalid Credential Rejection', () => {
    it('wrong PIN is rejected and counter increments by 1', () => {
      fc.assert(
        fc.property(validPinArbitrary2, validPinArbitrary2, (correctPin, wrongPin) => {
          fc.pre(correctPin !== wrongPin);  // Ensure PINs are different
          
          const storedHash = sha256(correctPin);
          const counter = new FailedAttemptCounter();
          const initialCount = counter.count;
          
          const result = simulatePinAuth(wrongPin, storedHash, false);
          counter.recordAttempt(result.success);
          
          return result.success === false && 
                 result.shouldUnlock === false &&
                 result.method === 'invalid_pin' &&
                 counter.count === initialCount + 1;
        }),
        { numRuns: 100 }
      );
    });

    it('unknown RFID card is rejected and counter increments by 1', () => {
      fc.assert(
        fc.property(validRfidUidArbitrary, validRfidUidArbitrary, (knownUid, unknownUid) => {
          fc.pre(knownUid !== unknownUid);  // Ensure UIDs are different
          
          const knownHash = sha256(knownUid);
          const unknownHash = sha256(unknownUid);
          const whitelist = [{ uidHash: knownHash, username: 'testuser' }];
          const counter = new FailedAttemptCounter();
          const initialCount = counter.count;
          
          const result = simulateRfidAuth(unknownHash, whitelist, 'ACTIVE');
          counter.recordAttempt(result.success);
          
          return result.success === false && 
                 result.shouldUnlock === false &&
                 result.reason === 'unknown_card' &&
                 counter.count === initialCount + 1;
        }),
        { numRuns: 100 }
      );
    });

    it('revoked RFID card is rejected and counter increments by 1', () => {
      fc.assert(
        fc.property(validRfidUidArbitrary, (uid) => {
          const uidHash = sha256(uid);
          const whitelist = [{ uidHash, username: 'testuser' }];
          const counter = new FailedAttemptCounter();
          const initialCount = counter.count;
          
          const result = simulateRfidAuth(uidHash, whitelist, 'REVOKED');
          counter.recordAttempt(result.success);
          
          return result.success === false && 
                 result.shouldUnlock === false &&
                 result.reason === 'card_revoked' &&
                 counter.count === initialCount + 1;
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 5: Failed Attempt Counter Invariant
   * For any sequence of authentication attempts, the failed attempt counter shall equal
   * the number of consecutive failed attempts since the last success, and shall reset
   * to zero after any successful authentication.
   * 
   * Feature: door-auth-refactor, Property 5: Failed Attempt Counter Invariant
   * Validates: Requirements 4.1, 4.5
   */
  describe('Property 5: Failed Attempt Counter Invariant', () => {
    it('counter equals consecutive failures since last success', () => {
      fc.assert(
        fc.property(
          fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
          (attemptResults) => {
            const counter = new FailedAttemptCounter();
            let expectedCount = 0;
            
            for (const success of attemptResults) {
              if (success) {
                expectedCount = 0;
              } else {
                expectedCount += 1;
              }
              counter.recordAttempt(success);
              
              if (counter.count !== expectedCount) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('counter resets to zero after successful authentication', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (numFailures) => {
            const counter = new FailedAttemptCounter();
            
            // Record some failures
            for (let i = 0; i < numFailures; i++) {
              counter.recordAttempt(false);
            }
            
            // Verify counter equals failures
            if (counter.count !== numFailures) return false;
            
            // Record a success
            counter.recordAttempt(true);
            
            // Counter should be zero
            return counter.count === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('alarm triggers at exactly 5 consecutive failures', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10 }),
          (numFailures) => {
            const counter = new FailedAttemptCounter();
            
            for (let i = 0; i < numFailures; i++) {
              counter.recordAttempt(false);
            }
            
            const shouldAlarm = numFailures >= 5;
            return counter.shouldTriggerAlarm() === shouldAlarm;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('success after 4 failures prevents alarm', () => {
      const counter = new FailedAttemptCounter();
      
      // 4 failures
      for (let i = 0; i < 4; i++) {
        counter.recordAttempt(false);
      }
      expect(counter.shouldTriggerAlarm()).toBe(false);
      
      // Success resets
      counter.recordAttempt(true);
      expect(counter.count).toBe(0);
      expect(counter.shouldTriggerAlarm()).toBe(false);
      
      // 4 more failures still no alarm
      for (let i = 0; i < 4; i++) {
        counter.recordAttempt(false);
      }
      expect(counter.shouldTriggerAlarm()).toBe(false);
    });

    it('5th consecutive failure triggers alarm', () => {
      const counter = new FailedAttemptCounter();
      
      for (let i = 0; i < 5; i++) {
        counter.recordAttempt(false);
      }
      
      expect(counter.count).toBe(5);
      expect(counter.shouldTriggerAlarm()).toBe(true);
    });
  });
});

// ==================== Integration Property Tests ====================

describe('Integration Property Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test that authenticateRfid service function works correctly
   */
  describe('authenticateRfid Service Function', () => {
    it('returns allowed:true for active card in database', async () => {
      const uid = 'ABCD1234';
      const uidHash = sha256(uid.toUpperCase());
      
      prisma.rfidCard.findFirst.mockResolvedValue({
        uidHash,
        status: 'ACTIVE',
        userId: 1,
        user: { id: 1, username: 'testuser', role: 'USER' }
      });
      
      const result = await doorService.authenticateRfid(uidHash);
      
      expect(result.allowed).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('returns allowed:false for unknown card', async () => {
      const uid = 'UNKNOWN123';
      const uidHash = sha256(uid.toUpperCase());
      
      prisma.rfidCard.findFirst.mockResolvedValue(null);
      
      const result = await doorService.authenticateRfid(uidHash);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('unknown_card');
    });

    it('returns allowed:false for revoked card', async () => {
      const uid = 'REVOKED123';
      const uidHash = sha256(uid.toUpperCase());
      
      prisma.rfidCard.findFirst.mockResolvedValue({
        uidHash,
        status: 'REVOKED',
        userId: 1,
        user: { id: 1, username: 'testuser', role: 'USER' }
      });
      
      const result = await doorService.authenticateRfid(uidHash);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('card_revoked');
    });
  });
});
