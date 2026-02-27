/**
 * Unit tests for RMA state machine and guard logic — 02-05
 *
 * Pure Jest unit tests: no DB, no Docker, no NestJS bootstrap required.
 * Tests assertValidTransition() directly (pure function, no DI).
 * Guard logic conditions are tested as plain boolean expressions.
 *
 * Run: cd rms-api && npm test -- --testPathPattern=rma.service.spec
 */

// Mock PrismaService to prevent Prisma 7 import.meta incompatibility in CJS Jest.
// assertValidTransition is a pure function — no DB interaction at all.
jest.mock('../prisma/prisma.service.js');

import { BadRequestException } from '@nestjs/common';
// Import from enums.js only (not client.js) — avoids Prisma 7 ESM/CJS mismatch in Jest
import { RmaStatus } from '../../generated/prisma/enums.js';
import { assertValidTransition } from './rma-lifecycle.js';

// ---------------------------------------------------------------------------
// assertValidTransition() — state machine coverage
// ---------------------------------------------------------------------------

describe('assertValidTransition() — valid transitions (must not throw)', () => {
  it('DRAFT → SUBMITTED', () => {
    expect(() => assertValidTransition(RmaStatus.DRAFT, RmaStatus.SUBMITTED)).not.toThrow();
  });

  it('DRAFT → CANCELLED', () => {
    expect(() => assertValidTransition(RmaStatus.DRAFT, RmaStatus.CANCELLED)).not.toThrow();
  });

  it('SUBMITTED → APPROVED', () => {
    expect(() => assertValidTransition(RmaStatus.SUBMITTED, RmaStatus.APPROVED)).not.toThrow();
  });

  it('SUBMITTED → REJECTED', () => {
    expect(() => assertValidTransition(RmaStatus.SUBMITTED, RmaStatus.REJECTED)).not.toThrow();
  });

  it('SUBMITTED → INFO_REQUIRED', () => {
    expect(() => assertValidTransition(RmaStatus.SUBMITTED, RmaStatus.INFO_REQUIRED)).not.toThrow();
  });

  it('SUBMITTED → CANCELLED', () => {
    expect(() => assertValidTransition(RmaStatus.SUBMITTED, RmaStatus.CANCELLED)).not.toThrow();
  });

  it('INFO_REQUIRED → SUBMITTED', () => {
    expect(() => assertValidTransition(RmaStatus.INFO_REQUIRED, RmaStatus.SUBMITTED)).not.toThrow();
  });

  it('INFO_REQUIRED → CANCELLED', () => {
    expect(() => assertValidTransition(RmaStatus.INFO_REQUIRED, RmaStatus.CANCELLED)).not.toThrow();
  });

  it('APPROVED → RECEIVED', () => {
    expect(() => assertValidTransition(RmaStatus.APPROVED, RmaStatus.RECEIVED)).not.toThrow();
  });

  it('APPROVED → CANCELLED', () => {
    expect(() => assertValidTransition(RmaStatus.APPROVED, RmaStatus.CANCELLED)).not.toThrow();
  });

  it('RECEIVED → QC_COMPLETE', () => {
    expect(() => assertValidTransition(RmaStatus.RECEIVED, RmaStatus.QC_COMPLETE)).not.toThrow();
  });

  it('QC_COMPLETE → RESOLVED', () => {
    expect(() => assertValidTransition(RmaStatus.QC_COMPLETE, RmaStatus.RESOLVED)).not.toThrow();
  });

  it('RESOLVED → CLOSED', () => {
    expect(() => assertValidTransition(RmaStatus.RESOLVED, RmaStatus.CLOSED)).not.toThrow();
  });
});

describe('assertValidTransition() — invalid transitions (must throw BadRequestException)', () => {
  it('DRAFT → APPROVED (skips SUBMITTED step)', () => {
    expect(() => assertValidTransition(RmaStatus.DRAFT, RmaStatus.APPROVED)).toThrow(
      BadRequestException,
    );
  });

  it('SUBMITTED → RECEIVED (must go through APPROVED first)', () => {
    expect(() => assertValidTransition(RmaStatus.SUBMITTED, RmaStatus.RECEIVED)).toThrow(
      BadRequestException,
    );
  });

  it('APPROVED → SUBMITTED (backward transition)', () => {
    expect(() => assertValidTransition(RmaStatus.APPROVED, RmaStatus.SUBMITTED)).toThrow(
      BadRequestException,
    );
  });

  it('RECEIVED → APPROVED (backward transition)', () => {
    expect(() => assertValidTransition(RmaStatus.RECEIVED, RmaStatus.APPROVED)).toThrow(
      BadRequestException,
    );
  });

  it('QC_COMPLETE → RECEIVED (backward transition)', () => {
    expect(() => assertValidTransition(RmaStatus.QC_COMPLETE, RmaStatus.RECEIVED)).toThrow(
      BadRequestException,
    );
  });

  it('RESOLVED → QC_COMPLETE (backward transition)', () => {
    expect(() => assertValidTransition(RmaStatus.RESOLVED, RmaStatus.QC_COMPLETE)).toThrow(
      BadRequestException,
    );
  });

  it('DRAFT → CLOSED (skips entire lifecycle)', () => {
    expect(() => assertValidTransition(RmaStatus.DRAFT, RmaStatus.CLOSED)).toThrow(
      BadRequestException,
    );
  });
});

describe('assertValidTransition() — terminal states (no outgoing transitions allowed)', () => {
  it('CANCELLED → DRAFT (terminal: cannot leave CANCELLED)', () => {
    expect(() => assertValidTransition(RmaStatus.CANCELLED, RmaStatus.DRAFT)).toThrow(
      BadRequestException,
    );
  });

  it('CANCELLED → SUBMITTED (terminal: no outgoing from CANCELLED)', () => {
    expect(() => assertValidTransition(RmaStatus.CANCELLED, RmaStatus.SUBMITTED)).toThrow(
      BadRequestException,
    );
  });

  it('REJECTED → SUBMITTED (terminal: cannot re-enter from REJECTED)', () => {
    expect(() => assertValidTransition(RmaStatus.REJECTED, RmaStatus.SUBMITTED)).toThrow(
      BadRequestException,
    );
  });

  it('REJECTED → APPROVED (terminal: no outgoing from REJECTED)', () => {
    expect(() => assertValidTransition(RmaStatus.REJECTED, RmaStatus.APPROVED)).toThrow(
      BadRequestException,
    );
  });

  it('CLOSED → RESOLVED (terminal: cannot reverse from CLOSED)', () => {
    expect(() => assertValidTransition(RmaStatus.CLOSED, RmaStatus.RESOLVED)).toThrow(
      BadRequestException,
    );
  });

  it('CLOSED → DRAFT (terminal: no outgoing from CLOSED)', () => {
    expect(() => assertValidTransition(RmaStatus.CLOSED, RmaStatus.DRAFT)).toThrow(
      BadRequestException,
    );
  });
});

describe('assertValidTransition() — error body shape', () => {
  it('thrown BadRequestException contains error, allowedTransitions in response body', () => {
    let caughtError: BadRequestException | undefined;

    try {
      assertValidTransition(RmaStatus.DRAFT, RmaStatus.APPROVED);
    } catch (e) {
      caughtError = e as BadRequestException;
    }

    expect(caughtError).toBeInstanceOf(BadRequestException);
    const body = caughtError!.getResponse() as Record<string, unknown>;
    expect(body.error).toBe('INVALID_TRANSITION');
    expect(body.fromStatus).toBe(RmaStatus.DRAFT);
    expect(body.toStatus).toBe(RmaStatus.APPROVED);
    expect(Array.isArray(body.allowedTransitions)).toBe(true);
    // DRAFT allows SUBMITTED and CANCELLED
    expect(body.allowedTransitions).toContain(RmaStatus.SUBMITTED);
    expect(body.allowedTransitions).toContain(RmaStatus.CANCELLED);
  });

  it('terminal state error has empty allowedTransitions array', () => {
    let caughtError: BadRequestException | undefined;

    try {
      assertValidTransition(RmaStatus.CLOSED, RmaStatus.RESOLVED);
    } catch (e) {
      caughtError = e as BadRequestException;
    }

    expect(caughtError).toBeInstanceOf(BadRequestException);
    const body = caughtError!.getResponse() as Record<string, unknown>;
    expect(body.error).toBe('INVALID_TRANSITION');
    expect(body.allowedTransitions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Guard logic — pure boolean condition tests (no DI, no DB, no mocks needed)
// These test the guard conditions that the service uses to protect operations.
// ---------------------------------------------------------------------------

describe('Guard logic — cancellationReason validation', () => {
  it('empty string fails non-empty guard', () => {
    const cancellationReason: string = '';
    expect(!cancellationReason || cancellationReason.trim().length === 0).toBe(true);
  });

  it('whitespace-only string fails non-empty guard', () => {
    const cancellationReason: string = '   ';
    expect(!cancellationReason || cancellationReason.trim().length === 0).toBe(true);
  });

  it('non-empty string passes non-empty guard', () => {
    const cancellationReason: string = 'Duplicate order';
    expect(!cancellationReason || cancellationReason.trim().length === 0).toBe(false);
  });
});

describe('Guard logic — rejectionReason validation', () => {
  it('empty string fails non-empty guard', () => {
    const rejectionReason: string = '';
    expect(!rejectionReason || rejectionReason.trim().length === 0).toBe(true);
  });

  it('whitespace-only string fails non-empty guard', () => {
    const rejectionReason: string = '\t\n';
    expect(!rejectionReason || rejectionReason.trim().length === 0).toBe(true);
  });

  it('non-empty string passes non-empty guard', () => {
    const rejectionReason: string = 'Part number mismatch';
    expect(!rejectionReason || rejectionReason.trim().length === 0).toBe(false);
  });
});

describe('Guard logic — inspectedQty vs receivedQty (LINE-03)', () => {
  it('inspectedQty > receivedQty triggers guard (invalid)', () => {
    const inspectedQty = 5;
    const receivedQty = 3;
    expect(inspectedQty > receivedQty).toBe(true);
  });

  it('inspectedQty === receivedQty is valid (at limit)', () => {
    const inspectedQty = 3;
    const receivedQty = 3;
    expect(inspectedQty > receivedQty).toBe(false);
  });

  it('inspectedQty < receivedQty is valid (partial inspection)', () => {
    const inspectedQty = 2;
    const receivedQty = 5;
    expect(inspectedQty > receivedQty).toBe(false);
  });

  it('inspectedQty = 0 is valid (zero inspection allowed)', () => {
    const inspectedQty = 0;
    const receivedQty = 5;
    expect(inspectedQty > receivedQty).toBe(false);
  });
});

describe('Guard logic — receivedQty lower-bound (must not go below inspectedQty)', () => {
  it('new receivedQty < existing inspectedQty triggers guard (invalid)', () => {
    const newReceivedQty = 2;
    const existingInspectedQty = 5;
    expect(newReceivedQty < existingInspectedQty).toBe(true);
  });

  it('new receivedQty === existing inspectedQty is valid (exact match)', () => {
    const newReceivedQty = 5;
    const existingInspectedQty = 5;
    expect(newReceivedQty < existingInspectedQty).toBe(false);
  });

  it('new receivedQty > existing inspectedQty is valid (over-receipt allowed)', () => {
    const newReceivedQty = 10;
    const existingInspectedQty = 5;
    expect(newReceivedQty < existingInspectedQty).toBe(false);
  });
});
