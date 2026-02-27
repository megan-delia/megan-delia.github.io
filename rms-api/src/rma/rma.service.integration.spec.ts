/**
 * Integration tests for RmaService — 02-05
 *
 * Tests all 14 LCYC/LINE requirements against a real Postgres database.
 * Uses the same NestJS TestingModule pattern established in Phase 1 (audit.integration.spec.ts).
 *
 * Prerequisites:
 *   docker compose up -d (postgres container running)
 *   DATABASE_URL env var pointing to rms_dev database
 *   npx prisma migrate deploy (migrations applied)
 *
 * Run: cd rms-api && npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { RmaModule } from './rma.module.js';
import { RmaService } from './rma.service.js';
import { AuditAction } from '../audit/audit.types.js';
// Vitest uses ESM natively — full Prisma client works correctly here
import { RmaStatus, RmsRole } from '../../generated/prisma/client.js';
import { RmaActorContext } from './rma.types.js';

describe('RmaService Integration', () => {
  let moduleRef: TestingModule;
  let rmaService: RmaService;
  let prisma: PrismaService;

  // Seed data — one branch and user reused across all tests
  let seedBranch: { id: string };
  let seedUser: { id: string; portalUserId: string; email: string };
  let actor: RmaActorContext;

  // Track all created RMA IDs for cleanup
  const createdRmaIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        RmaModule,
      ],
    }).compile();

    rmaService = moduleRef.get(RmaService);
    prisma = moduleRef.get(PrismaService);

    // Seed a Branch and User (RETURNS_AGENT) for use across all tests
    const ts = Date.now();
    seedBranch = await prisma.branch.create({
      data: { name: `Integration Test Branch ${ts}`, code: `IT-${ts}` },
    });

    seedUser = await prisma.user.create({
      data: {
        portalUserId: `test-portal-${ts}`,
        email: `test-${ts}@integration.example`,
        displayName: 'Integration Test Agent',
        branchRoles: {
          create: [
            {
              branchId: seedBranch.id,
              role: RmsRole.RETURNS_AGENT,
              assignedBy: 'system',
            },
          ],
        },
      },
    });

    actor = {
      id: seedUser.id,
      portalUserId: seedUser.portalUserId,
      email: seedUser.email,
      role: RmsRole.RETURNS_AGENT,
      branchIds: [seedBranch.id],
      isAdmin: false,
    };
  });

  afterAll(async () => {
    // Cleanup in FK-safe reverse order
    await prisma.auditEvent.deleteMany({ where: { rmaId: { in: createdRmaIds } } });
    await prisma.rmaLine.deleteMany({ where: { rmaId: { in: createdRmaIds } } });
    await prisma.rma.deleteMany({ where: { id: { in: createdRmaIds } } });
    await prisma.userBranchRole.deleteMany({ where: { userId: seedUser.id } });
    await prisma.user.delete({ where: { id: seedUser.id } });
    await prisma.branch.delete({ where: { id: seedBranch.id } });
    await moduleRef.close();
  });

  // Helper: create a fresh DRAFT RMA with one line; track its ID for cleanup
  async function createDraftRma() {
    const rma = await rmaService.createDraft(
      {
        branchId: seedBranch.id,
        lines: [
          {
            partNumber: 'PART-001',
            orderedQty: 10,
            reasonCode: 'DEFECTIVE',
          },
        ],
      },
      actor,
    );
    createdRmaIds.push(rma.id);
    return rma;
  }

  // Helper: progress an RMA through the full lifecycle up to APPROVED
  async function getApprovedRma() {
    const rma = await createDraftRma();
    await rmaService.submit(rma.id, actor);
    return rmaService.approve(rma.id, actor);
  }

  // ---------------------------------------------------------------------------
  // LCYC-01 + LINE-01: createDraft()
  // ---------------------------------------------------------------------------

  describe('LCYC-01 + LINE-01: createDraft()', () => {
    it('creates RMA in DRAFT status with all provided line items', async () => {
      const rma = await rmaService.createDraft(
        {
          branchId: seedBranch.id,
          lines: [
            { partNumber: 'PART-A1', orderedQty: 5, reasonCode: 'WRONG_ITEM' },
            { partNumber: 'PART-A2', orderedQty: 3, reasonCode: 'DEFECTIVE' },
          ],
        },
        actor,
      );
      createdRmaIds.push(rma.id);

      expect(rma.status).toBe(RmaStatus.DRAFT);
      expect(rma.lines).toHaveLength(2);
      expect(rma.lines[0].partNumber).toBe('PART-A1');
      expect(rma.lines[0].orderedQty).toBe(5);
      expect(rma.lines[1].partNumber).toBe('PART-A2');
      expect(rma.lines[1].orderedQty).toBe(3);
      expect(rma.rmaNumber).toMatch(/^RMA-\d{6}-\d{6}$/);
    });

    it('writes AuditEvent with action RMA_CREATED in same transaction', async () => {
      const rma = await createDraftRma();

      const auditRow = await prisma.auditEvent.findFirst({
        where: { rmaId: rma.id, action: AuditAction.RMA_CREATED },
      });

      expect(auditRow).not.toBeNull();
      expect(auditRow!.action).toBe(AuditAction.RMA_CREATED);
      expect(auditRow!.actorId).toBe(seedUser.id);
      expect(auditRow!.toStatus).toBe(RmaStatus.DRAFT);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-02: submit()
  // ---------------------------------------------------------------------------

  describe('LCYC-02: submit()', () => {
    it('transitions DRAFT → SUBMITTED and writes RMA_SUBMITTED audit event', async () => {
      const rma = await createDraftRma();
      const submitted = await rmaService.submit(rma.id, actor);

      expect(submitted.status).toBe(RmaStatus.SUBMITTED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { rmaId: rma.id, action: AuditAction.RMA_SUBMITTED },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.fromStatus).toBe(RmaStatus.DRAFT);
      expect(auditRow!.toStatus).toBe(RmaStatus.SUBMITTED);
    });

    it('throws BadRequestException when called on an already SUBMITTED RMA (invalid transition)', async () => {
      const rma = await createDraftRma();
      await rmaService.submit(rma.id, actor);

      await expect(rmaService.submit(rma.id, actor)).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-03: approve()
  // ---------------------------------------------------------------------------

  describe('LCYC-03: approve()', () => {
    it('transitions SUBMITTED → APPROVED and writes RMA_APPROVED audit event', async () => {
      const rma = await createDraftRma();
      await rmaService.submit(rma.id, actor);
      const approved = await rmaService.approve(rma.id, actor);

      expect(approved.status).toBe(RmaStatus.APPROVED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { rmaId: rma.id, action: AuditAction.RMA_APPROVED },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.fromStatus).toBe(RmaStatus.SUBMITTED);
      expect(auditRow!.toStatus).toBe(RmaStatus.APPROVED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-04: reject()
  // ---------------------------------------------------------------------------

  describe('LCYC-04: reject()', () => {
    it('transitions SUBMITTED → REJECTED with rejectionReason stored', async () => {
      const rma = await createDraftRma();
      await rmaService.submit(rma.id, actor);
      const rejected = await rmaService.reject(
        rma.id,
        { rejectionReason: 'Part number mismatch' },
        actor,
      );

      expect(rejected.status).toBe(RmaStatus.REJECTED);

      // Verify rejectionReason persisted in DB
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.rejectionReason).toBe('Part number mismatch');
    });

    it('throws BadRequestException when rejectionReason is empty string', async () => {
      const rma = await createDraftRma();
      await rmaService.submit(rma.id, actor);

      await expect(
        rmaService.reject(rma.id, { rejectionReason: '' }, actor),
      ).rejects.toThrow(BadRequestException);

      // RMA must remain SUBMITTED (no state change written)
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.SUBMITTED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-05: placeInfoRequired()
  // ---------------------------------------------------------------------------

  describe('LCYC-05: placeInfoRequired()', () => {
    it('transitions SUBMITTED → INFO_REQUIRED and writes RMA_INFO_REQUIRED audit event', async () => {
      const rma = await createDraftRma();
      await rmaService.submit(rma.id, actor);
      const infoRequired = await rmaService.placeInfoRequired(
        rma.id,
        { infoRequestNote: 'Please attach invoice' },
        actor,
      );

      expect(infoRequired.status).toBe(RmaStatus.INFO_REQUIRED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { rmaId: rma.id, action: AuditAction.RMA_INFO_REQUIRED },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.toStatus).toBe(RmaStatus.INFO_REQUIRED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-06: resubmit()
  // ---------------------------------------------------------------------------

  describe('LCYC-06: resubmit()', () => {
    it('transitions INFO_REQUIRED → SUBMITTED with metadata.cycle = resubmit', async () => {
      const rma = await createDraftRma();
      await rmaService.submit(rma.id, actor);
      await rmaService.placeInfoRequired(rma.id, {}, actor);
      const resubmitted = await rmaService.resubmit(rma.id, actor);

      expect(resubmitted.status).toBe(RmaStatus.SUBMITTED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: {
          rmaId: rma.id,
          action: AuditAction.RMA_SUBMITTED,
          fromStatus: RmaStatus.INFO_REQUIRED,
        },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.toStatus).toBe(RmaStatus.SUBMITTED);
      // metadata.cycle = 'resubmit' per plan spec
      const metadata = auditRow!.metadata as Record<string, unknown> | null;
      expect(metadata?.cycle).toBe('resubmit');
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-11: cancel()
  // ---------------------------------------------------------------------------

  describe('LCYC-11: cancel()', () => {
    it('transitions DRAFT → CANCELLED with cancellationReason stored', async () => {
      const rma = await createDraftRma();
      const cancelled = await rmaService.cancel(
        rma.id,
        { cancellationReason: 'Customer changed mind' },
        actor,
      );

      expect(cancelled.status).toBe(RmaStatus.CANCELLED);

      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.cancellationReason).toBe('Customer changed mind');
    });

    it('throws BadRequestException when cancellationReason is empty', async () => {
      const rma = await createDraftRma();

      await expect(
        rmaService.cancel(rma.id, { cancellationReason: '' }, actor),
      ).rejects.toThrow(BadRequestException);

      // RMA must remain DRAFT (no state change written)
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.DRAFT);
    });

    it('throws BadRequestException when attempting to cancel an already CANCELLED RMA', async () => {
      const rma = await createDraftRma();
      await rmaService.cancel(rma.id, { cancellationReason: 'Test cancel' }, actor);

      // CANCELLED is terminal — no outgoing transitions
      await expect(
        rmaService.cancel(rma.id, { cancellationReason: 'Cancel again' }, actor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-07 + LINE-03: recordReceipt()
  // ---------------------------------------------------------------------------

  describe('LCYC-07 + LINE-03: recordReceipt()', () => {
    it('first receipt transitions APPROVED → RECEIVED and updates line.receivedQty', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      const received = await rmaService.recordReceipt(
        rma.id,
        line1.id,
        { receivedQty: 7 },
        actor,
      );

      expect(received.status).toBe(RmaStatus.RECEIVED);
      const updatedLine = received.lines.find((l) => l.id === line1.id);
      expect(updatedLine!.receivedQty).toBe(7);
    });

    it('second receipt keeps status as RECEIVED (no duplicate transition) and exactly one RMA_RECEIVED audit entry remains', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      // First receipt
      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 5 }, actor);

      // Confirm status is RECEIVED after first call
      const afterFirst = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(afterFirst!.status).toBe(RmaStatus.RECEIVED);

      // Second receipt — status must remain RECEIVED (not double-transitioned)
      const afterSecond = await rmaService.recordReceipt(
        rma.id,
        line1.id,
        { receivedQty: 8 },
        actor,
      );
      expect(afterSecond.status).toBe(RmaStatus.RECEIVED);

      // Exactly one audit event with fromStatus = APPROVED (the transition event)
      const receivedAuditEventsWithTransition = await prisma.auditEvent.findMany({
        where: {
          rmaId: rma.id,
          action: AuditAction.RMA_RECEIVED,
          fromStatus: RmaStatus.APPROVED,
        },
      });
      expect(receivedAuditEventsWithTransition).toHaveLength(1);
    });

    it('over-receipt (receivedQty > orderedQty) succeeds — over-receipt is allowed', async () => {
      const rma = await getApprovedRma(); // orderedQty = 10
      const line1 = rma.lines[0];

      // receivedQty = 15 exceeds orderedQty = 10 — must NOT throw
      const result = await rmaService.recordReceipt(
        rma.id,
        line1.id,
        { receivedQty: 15 },
        actor,
      );

      const updatedLine = result.lines.find((l) => l.id === line1.id);
      expect(updatedLine!.receivedQty).toBe(15);
      expect(result.status).toBe(RmaStatus.RECEIVED);
    });

    it('throws BadRequestException when receivedQty is below existing inspectedQty', async () => {
      // Set up: RECEIVED with inspectedQty already recorded
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      // First: record receipt to RECEIVED
      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 10 }, actor);

      // Then: record QC inspection (sets inspectedQty = 8)
      await rmaService.recordQcInspection(rma.id, line1.id, { lineId: line1.id, inspectedQty: 8 }, actor);

      // Now try to set receivedQty = 5 (below inspectedQty = 8) — must throw
      await expect(
        rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 5 }, actor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-08 + LINE-03: recordQcInspection()
  // ---------------------------------------------------------------------------

  describe('LCYC-08 + LINE-03: recordQcInspection()', () => {
    it('sets inspectedQty and qcInspectedAt on the line', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 10 }, actor);
      const result = await rmaService.recordQcInspection(
        rma.id,
        line1.id,
        { lineId: line1.id, inspectedQty: 7, qcFindings: 'Minor cosmetic damage' },
        actor,
      );

      const updatedLine = result.lines.find((l) => l.id === line1.id);
      expect(updatedLine!.inspectedQty).toBe(7);
      expect(updatedLine!.qcInspectedAt).not.toBeNull();
      expect(updatedLine!.qcInspectedAt).toBeInstanceOf(Date);
    });

    it('inspectedQty = 0 succeeds (zero inspection is valid)', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 5 }, actor);
      const result = await rmaService.recordQcInspection(
        rma.id,
        line1.id,
        { lineId: line1.id, inspectedQty: 0 },
        actor,
      );

      const updatedLine = result.lines.find((l) => l.id === line1.id);
      expect(updatedLine!.inspectedQty).toBe(0);
      expect(updatedLine!.qcInspectedAt).not.toBeNull();
    });

    it('throws BadRequestException when inspectedQty > receivedQty', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 5 }, actor);

      // inspectedQty = 10 exceeds receivedQty = 5 — must throw
      await expect(
        rmaService.recordQcInspection(rma.id, line1.id, { lineId: line1.id, inspectedQty: 10 }, actor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-08 completion: completeQc()
  // ---------------------------------------------------------------------------

  describe('LCYC-08 completion: completeQc()', () => {
    it('transitions RECEIVED → QC_COMPLETE', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 10 }, actor);
      await rmaService.recordQcInspection(rma.id, line1.id, { lineId: line1.id, inspectedQty: 10 }, actor);
      const qcComplete = await rmaService.completeQc(rma.id, actor);

      expect(qcComplete.status).toBe(RmaStatus.QC_COMPLETE);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-09: resolve()
  // ---------------------------------------------------------------------------

  describe('LCYC-09: resolve()', () => {
    it('transitions QC_COMPLETE → RESOLVED', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 10 }, actor);
      await rmaService.recordQcInspection(rma.id, line1.id, { lineId: line1.id, inspectedQty: 10 }, actor);
      await rmaService.completeQc(rma.id, actor);
      const resolved = await rmaService.resolve(rma.id, actor);

      expect(resolved.status).toBe(RmaStatus.RESOLVED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { rmaId: rma.id, action: AuditAction.RMA_RESOLVED },
      });
      expect(auditRow).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-10: close()
  // ---------------------------------------------------------------------------

  describe('LCYC-10: close()', () => {
    it('transitions RESOLVED → CLOSED', async () => {
      const rma = await getApprovedRma();
      const line1 = rma.lines[0];

      await rmaService.recordReceipt(rma.id, line1.id, { receivedQty: 10 }, actor);
      await rmaService.recordQcInspection(rma.id, line1.id, { lineId: line1.id, inspectedQty: 10 }, actor);
      await rmaService.completeQc(rma.id, actor);
      await rmaService.resolve(rma.id, actor);
      const closed = await rmaService.close(rma.id, actor);

      expect(closed.status).toBe(RmaStatus.CLOSED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { rmaId: rma.id, action: AuditAction.RMA_CLOSED },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow!.toStatus).toBe(RmaStatus.CLOSED);
    });
  });

  // ---------------------------------------------------------------------------
  // LINE-02: disposition lock (qcInspectedAt as lock trigger)
  // ---------------------------------------------------------------------------

  describe('LINE-02: disposition lock', () => {
    it('updateLine() succeeds when qcInspectedAt is null (before QC)', async () => {
      const rma = await createDraftRma();
      const line1 = rma.lines[0];

      // DRAFT status — qcInspectedAt is null — update should succeed
      const updated = await rmaService.updateLine(
        rma.id,
        line1.id,
        { disposition: 'CREDIT' },
        actor,
      );

      const updatedLine = updated.lines.find((l) => l.id === line1.id);
      expect(updatedLine!.disposition).toBe('CREDIT');
    });

    it('updateLine() throws BadRequestException when qcInspectedAt is set (disposition locked)', async () => {
      // Need a DRAFT rma that somehow has qcInspectedAt set
      // The only way qcInspectedAt gets set is via recordQcInspection().
      // However, updateLine() only works in DRAFT or INFO_REQUIRED.
      // We need to verify the guard: `data.disposition !== undefined && line.qcInspectedAt !== null`
      //
      // Workaround: directly set qcInspectedAt via Prisma to simulate a locked line in DRAFT context
      const rma = await createDraftRma();
      const line1 = rma.lines[0];

      // Directly set qcInspectedAt on the line to simulate post-inspection state
      await prisma.rmaLine.update({
        where: { id: line1.id },
        data: { qcInspectedAt: new Date(), inspectedQty: 5 },
      });

      // Now updateLine() with a disposition change must throw (line is locked)
      await expect(
        rmaService.updateLine(rma.id, line1.id, { disposition: 'REPLACEMENT' }, actor),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
