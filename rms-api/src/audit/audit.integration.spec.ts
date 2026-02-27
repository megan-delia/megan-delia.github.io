/**
 * Integration tests for AuditService.logEvent() — FOUND-04
 *
 * Tests against the real test database to confirm actual DB writes,
 * not just type compliance.
 *
 * ROADMAP criterion: "Every state change writes audit event in same transaction"
 *
 * Prerequisites:
 *   docker compose up -d (postgres container running)
 *   DATABASE_URL env var pointing to rms_dev database
 *   npx prisma migrate deploy (migrations applied)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditModule } from './audit.module.js';
import { AuditService } from './audit.service.js';
import { AuditAction } from './audit.types.js';

describe('AuditService — FOUND-04: Atomic audit log', () => {
  let prisma: PrismaService;
  let auditService: AuditService;
  let testActorId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    auditService = moduleRef.get(AuditService);

    // Seed a User row to use as actorId (AuditEvent has FK to User)
    const user = await prisma.user.create({
      data: {
        portalUserId: `portal-audit-${Date.now()}`,
        email: `audit-actor-${Date.now()}@test.example`,
        displayName: 'Audit Test Actor',
      },
    });
    testActorId = user.id;
  });

  afterAll(async () => {
    // Clean up audit events and the test user
    await prisma.auditEvent.deleteMany({ where: { actorId: testActorId } });
    await prisma.user.delete({ where: { id: testActorId } });
  });

  it('FOUND-04: logEvent inside $transaction writes AuditEvent row to DB', async () => {
    await prisma.$transaction(async (tx) => {
      await auditService.logEvent(tx, {
        actorId: testActorId,
        actorRole: 'RETURNS_AGENT',
        action: AuditAction.RMA_CREATED,
      });
    });

    const row = await prisma.auditEvent.findFirst({
      where: { actorId: testActorId, action: AuditAction.RMA_CREATED },
    });

    expect(row).not.toBeNull();
    expect(row!.action).toBe('RMA_CREATED');
    expect(row!.actorRole).toBe('RETURNS_AGENT');
    expect(row!.occurredAt).toBeInstanceOf(Date);
  });

  it('FOUND-04: rollback removes both state change and audit event (atomicity)', async () => {
    // Generate unique rmaId-like marker so we can query specifically for this test's rows
    const testRmaId = `test-rma-rollback-${Date.now()}`;

    // Simulate a transaction that writes an audit event then throws
    // Both the audit write and any other write inside the tx should be rolled back
    await expect(
      prisma.$transaction(async (tx) => {
        await auditService.logEvent(tx, {
          actorId: testActorId,
          actorRole: 'RETURNS_AGENT',
          action: AuditAction.STATUS_CHANGED,
          rmaId: testRmaId,
          metadata: { test: 'rollback-marker' },
        });
        // Throw AFTER writing the audit event — should cause full rollback
        throw new Error('Intentional rollback for atomicity test');
      }),
    ).rejects.toThrow('Intentional rollback for atomicity test');

    // Verify the audit event was NOT persisted (rolled back)
    const row = await prisma.auditEvent.findFirst({
      where: { rmaId: testRmaId },
    });

    expect(row).toBeNull();
  });
});
