/**
 * Integration tests for Phase 3.5 — Lifecycle HTTP Controller — 03.5-03
 *
 * Tests all 13 Phase 3.5 requirements against a real Postgres database.
 * Follows the exact same NestJS TestingModule pattern as workflow.integration.spec.ts (Phase 3)
 * and rma.service.integration.spec.ts (Phase 2). Tests call service and repository
 * methods directly via TestingModule — not HTTP requests.
 *
 * Requirement IDs covered:
 *   LCYC-01: createDraft creates a Draft RMA with lines
 *   LCYC-02: submit transitions DRAFT → SUBMITTED
 *   LCYC-05: placeInfoRequired transitions SUBMITTED → INFO_REQUIRED
 *   LCYC-06: resubmit transitions INFO_REQUIRED → SUBMITTED
 *   LCYC-07: recordReceipt records integer receivedQty per line; first receipt → RECEIVED
 *   LCYC-08: completeQc transitions RECEIVED → QC_COMPLETE
 *   LCYC-09: resolve transitions QC_COMPLETE → RESOLVED after all CREDIT lines approved
 *   LCYC-10: close transitions RESOLVED → CLOSED
 *   LCYC-11: cancel with required reason transitions DRAFT/SUBMITTED/APPROVED → CANCELLED
 *   LINE-01: addLine adds a new line; removeLine removes it; both blocked after SUBMITTED
 *   LINE-02: updateLine sets disposition on a line; disposition lock triggers after qcInspectedAt set
 *   LINE-03: receivedQty is integer per line; inspectedQty is integer per line
 *   WKFL-04: resolve() throws when any CREDIT line lacks financeApprovedAt
 *
 * Prerequisites:
 *   docker compose up -d (postgres container running)
 *   DATABASE_URL env var pointing to rms_dev database
 *   npx prisma migrate deploy (migrations applied)
 *
 * Run: cd rms-api && npm run test:e2e -- --reporter=verbose lifecycle.integration
 */

// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { RmaModule } from './rma.module.js';
import { RmaService } from './rma.service.js';
import { RmaRepository } from './rma.repository.js';
// Vitest uses ESM natively — full Prisma client works correctly here
import { RmaStatus, RmsRole, DispositionType } from '../../generated/prisma/client.js';
import { RmaActorContext } from './rma.types.js';
import { RmsUserContext } from '../users/users.service.js';

describe('Phase 3.5 Lifecycle HTTP Controller Integration', () => {
  let moduleRef: TestingModule;
  let rmaService: RmaService;
  let rmaRepository: RmaRepository;
  let prisma: PrismaService;

  // Shared fixtures — two branches, multiple role users created once per test suite
  let branchA: { id: string };
  let branchB: { id: string };

  let agentUser: { id: string; portalUserId: string; email: string };
  let managerUser: { id: string; portalUserId: string; email: string };
  let warehouseUser: { id: string; portalUserId: string; email: string };
  let qcUser: { id: string; portalUserId: string; email: string };
  let financeUser: { id: string; portalUserId: string; email: string };
  let branchBAgentUser: { id: string; portalUserId: string; email: string };

  // RmaActorContext shapes for service method calls
  let agentActor: RmaActorContext;
  let managerActor: RmaActorContext;
  let warehouseActor: RmaActorContext;
  let qcActor: RmaActorContext;
  let financeActor: RmaActorContext;

  // RmsUserContext shapes for repository method calls (findByIdBranchScoped, findManyBranchScoped)
  let agentContext: RmsUserContext;
  let branchBContext: RmsUserContext;

  // Track all created RMA IDs for FK-safe cleanup
  const createdRmaIds: string[] = [];

  // Track created user IDs for cleanup
  const createdUserIds: string[] = [];

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
    rmaRepository = moduleRef.get(RmaRepository);
    prisma = moduleRef.get(PrismaService);

    const ts = Date.now();

    // Create two branches: A (primary) and B (for cross-branch isolation tests)
    branchA = await prisma.branch.create({
      data: { name: `Lifecycle Test Branch A ${ts}`, code: `LC-A-${ts}` },
    });
    branchB = await prisma.branch.create({
      data: { name: `Lifecycle Test Branch B ${ts}`, code: `LC-B-${ts}` },
    });

    // Create all role users at branchA
    agentUser = await prisma.user.create({
      data: {
        portalUserId: `lc-agent-${ts}`,
        email: `lc-agent-${ts}@test.example`,
        displayName: 'LC Returns Agent',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.RETURNS_AGENT, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(agentUser.id);

    managerUser = await prisma.user.create({
      data: {
        portalUserId: `lc-manager-${ts}`,
        email: `lc-manager-${ts}@test.example`,
        displayName: 'LC Branch Manager',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.BRANCH_MANAGER, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(managerUser.id);

    warehouseUser = await prisma.user.create({
      data: {
        portalUserId: `lc-warehouse-${ts}`,
        email: `lc-warehouse-${ts}@test.example`,
        displayName: 'LC Warehouse User',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.WAREHOUSE, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(warehouseUser.id);

    qcUser = await prisma.user.create({
      data: {
        portalUserId: `lc-qc-${ts}`,
        email: `lc-qc-${ts}@test.example`,
        displayName: 'LC QC User',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.QC, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(qcUser.id);

    financeUser = await prisma.user.create({
      data: {
        portalUserId: `lc-finance-${ts}`,
        email: `lc-finance-${ts}@test.example`,
        displayName: 'LC Finance User',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.FINANCE, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(financeUser.id);

    // branchB agent — scoped only to branchB (cross-branch isolation)
    branchBAgentUser = await prisma.user.create({
      data: {
        portalUserId: `lc-branchb-agent-${ts}`,
        email: `lc-branchb-agent-${ts}@test.example`,
        displayName: 'LC Branch B Agent',
        branchRoles: {
          create: [{ branchId: branchB.id, role: RmsRole.RETURNS_AGENT, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(branchBAgentUser.id);

    // Actor contexts (RmaActorContext) for service calls
    agentActor = {
      id: agentUser.id,
      portalUserId: agentUser.portalUserId,
      email: agentUser.email,
      role: RmsRole.RETURNS_AGENT,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    managerActor = {
      id: managerUser.id,
      portalUserId: managerUser.portalUserId,
      email: managerUser.email,
      role: RmsRole.BRANCH_MANAGER,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    warehouseActor = {
      id: warehouseUser.id,
      portalUserId: warehouseUser.portalUserId,
      email: warehouseUser.email,
      role: RmsRole.WAREHOUSE,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    qcActor = {
      id: qcUser.id,
      portalUserId: qcUser.portalUserId,
      email: qcUser.email,
      role: RmsRole.QC,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    financeActor = {
      id: financeUser.id,
      portalUserId: financeUser.portalUserId,
      email: financeUser.email,
      role: RmsRole.FINANCE,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    // RmsUserContext shapes for repository calls (findByIdBranchScoped / findManyBranchScoped)
    agentContext = {
      id: agentUser.id,
      portalUserId: agentUser.portalUserId,
      email: agentUser.email,
      role: RmsRole.RETURNS_AGENT,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    // branchB context — has no access to branchA RMAs
    branchBContext = {
      id: branchBAgentUser.id,
      portalUserId: branchBAgentUser.portalUserId,
      email: branchBAgentUser.email,
      role: RmsRole.RETURNS_AGENT,
      branchIds: [branchB.id],
      isAdmin: false,
    };
  });

  afterAll(async () => {
    // FK-safe cleanup: audit → line → rma → userBranchRole → user → branch
    if (createdRmaIds.length > 0) {
      await prisma.auditEvent.deleteMany({ where: { rmaId: { in: createdRmaIds } } });
      await prisma.rmaLine.deleteMany({ where: { rmaId: { in: createdRmaIds } } });
      await prisma.rma.deleteMany({ where: { id: { in: createdRmaIds } } });
    }
    for (const userId of createdUserIds) {
      await prisma.userBranchRole.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.branch.delete({ where: { id: branchA.id } });
    await prisma.branch.delete({ where: { id: branchB.id } });
    await moduleRef.close();
  });

  // ----------------------------------------------------------------
  // Helper: create a fresh DRAFT RMA with one line at branchA
  // ----------------------------------------------------------------
  async function createDraftRma(branchId = branchA.id, orderedQty = 5) {
    const rma = await rmaService.createDraft(
      {
        branchId,
        lines: [{ partNumber: 'P-001', orderedQty, reasonCode: 'DEFECTIVE' }],
      },
      agentActor,
    );
    createdRmaIds.push(rma.id);
    return rma;
  }

  // Helper: advance to SUBMITTED
  async function getSubmittedRma(branchId = branchA.id) {
    const rma = await createDraftRma(branchId);
    return rmaService.submit(rma.id, agentActor);
  }

  // Helper: advance to APPROVED (draft → submit → approve)
  async function getApprovedRma(branchId = branchA.id) {
    const rma = await getSubmittedRma(branchId);
    return rmaService.approve(rma.id, managerActor);
  }

  // Helper: advance to QC_COMPLETE with a CREDIT disposition line (draft → submit → approve → receive → completeQc)
  async function getQcCompleteWithCredit() {
    const rma = await getApprovedRma();
    const lineId = rma.lines[0].id;

    // Set disposition to CREDIT before receipt (while in DRAFT/before SUBMITTED lock)
    // Note: must set disposition before approval; service allows it in DRAFT only.
    // Re-create a draft with CREDIT disposition to avoid lock:
    const draftWithCredit = await rmaService.createDraft(
      {
        branchId: branchA.id,
        lines: [{ partNumber: 'P-CREDIT', orderedQty: 4, reasonCode: 'DEFECTIVE', disposition: 'CREDIT' }],
      },
      agentActor,
    );
    createdRmaIds.push(draftWithCredit.id);
    const creditLineId = draftWithCredit.lines[0].id;

    // Submit → approve → receive → completeQc
    await rmaService.submit(draftWithCredit.id, agentActor);
    await rmaService.approve(draftWithCredit.id, managerActor);
    await rmaService.recordReceipt(draftWithCredit.id, creditLineId, { receivedQty: 4 }, warehouseActor);
    await rmaService.recordQcInspection(
      draftWithCredit.id,
      creditLineId,
      { lineId: creditLineId, inspectedQty: 4, qcPass: true },
      qcActor,
    );
    await rmaService.completeQc(draftWithCredit.id, qcActor);

    // Re-fetch for fresh state
    const updated = await rmaRepository.findById(draftWithCredit.id);
    return updated!;
  }

  // ---------------------------------------------------------------------------
  // LCYC-01: createDraft creates a Draft RMA with lines
  // ---------------------------------------------------------------------------

  describe('LCYC-01: createDraft creates a Draft RMA with lines', () => {
    it('creates an RMA in DRAFT status with all provided lines', async () => {
      const result = await rmaService.createDraft(
        {
          branchId: branchA.id,
          lines: [{ partNumber: 'P-001', orderedQty: 3, reasonCode: 'DEFECTIVE' }],
        },
        agentActor,
      );
      createdRmaIds.push(result.id);

      expect(result.status).toBe(RmaStatus.DRAFT);
      expect(result.lines).toHaveLength(1);
      expect(result.rmaNumber).toMatch(/^RMA-/);
      expect(result.lines[0].partNumber).toBe('P-001');
      expect(result.lines[0].orderedQty).toBe(3);
      // LINE-03: receivedQty and inspectedQty start at 0 (integer)
      expect(result.lines[0].receivedQty).toBe(0);
      expect(result.lines[0].inspectedQty).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-02: submit transitions DRAFT → SUBMITTED
  // ---------------------------------------------------------------------------

  describe('LCYC-02: submit transitions DRAFT → SUBMITTED', () => {
    it('transitions status from DRAFT to SUBMITTED', async () => {
      const rma = await createDraftRma();
      const result = await rmaService.submit(rma.id, agentActor);
      expect(result.status).toBe(RmaStatus.SUBMITTED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-05: placeInfoRequired transitions SUBMITTED → INFO_REQUIRED
  // ---------------------------------------------------------------------------

  describe('LCYC-05: placeInfoRequired transitions SUBMITTED → INFO_REQUIRED', () => {
    it('transitions status from SUBMITTED to INFO_REQUIRED', async () => {
      const rma = await getSubmittedRma();
      const result = await rmaService.placeInfoRequired(
        rma.id,
        { infoRequestNote: 'Need serial numbers' },
        agentActor,
      );
      expect(result.status).toBe(RmaStatus.INFO_REQUIRED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-06: resubmit transitions INFO_REQUIRED → SUBMITTED
  // ---------------------------------------------------------------------------

  describe('LCYC-06: resubmit transitions INFO_REQUIRED → SUBMITTED', () => {
    it('transitions status from INFO_REQUIRED back to SUBMITTED', async () => {
      const rma = await getSubmittedRma();
      await rmaService.placeInfoRequired(rma.id, { infoRequestNote: 'Missing docs' }, agentActor);
      const result = await rmaService.resubmit(rma.id, agentActor);
      expect(result.status).toBe(RmaStatus.SUBMITTED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-07 + LINE-03: recordReceipt records integer receivedQty per line; first receipt → RECEIVED
  // ---------------------------------------------------------------------------

  describe('LCYC-07 + LINE-03: recordReceipt records integer receivedQty; first receipt → RECEIVED', () => {
    it('records receivedQty on the line and transitions APPROVED → RECEIVED on first receipt', async () => {
      const rma = await getApprovedRma();
      const lineId = rma.lines[0].id;

      // LINE-03: inspectedQty starts at 0 before any receipt
      expect(rma.lines[0].inspectedQty).toBe(0);

      const result = await rmaService.recordReceipt(rma.id, lineId, { receivedQty: 2 }, warehouseActor);

      // LCYC-07: first receipt transitions to RECEIVED
      expect(result.status).toBe(RmaStatus.RECEIVED);
      // LINE-03: receivedQty is integer
      expect(result.lines[0].receivedQty).toBe(2);
    });

    it('LINE-03: inspectedQty is set to integer after QC inspection', async () => {
      const rma = await getApprovedRma();
      const lineId = rma.lines[0].id;

      await rmaService.recordReceipt(rma.id, lineId, { receivedQty: 5 }, warehouseActor);
      await rmaService.recordQcInspection(
        rma.id,
        lineId,
        { lineId, inspectedQty: 3, qcPass: true },
        qcActor,
      );

      const dbLine = await prisma.rmaLine.findUnique({ where: { id: lineId } });
      // LINE-03: inspectedQty is integer
      expect(dbLine!.inspectedQty).toBe(3);
      expect(Number.isInteger(dbLine!.inspectedQty)).toBe(true);
      expect(Number.isInteger(dbLine!.receivedQty)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-08: completeQc transitions RECEIVED → QC_COMPLETE
  // ---------------------------------------------------------------------------

  describe('LCYC-08: completeQc transitions RECEIVED → QC_COMPLETE', () => {
    it('transitions status from RECEIVED to QC_COMPLETE', async () => {
      const rma = await getApprovedRma();
      const lineId = rma.lines[0].id;

      await rmaService.recordReceipt(rma.id, lineId, { receivedQty: 5 }, warehouseActor);
      const result = await rmaService.completeQc(rma.id, qcActor);

      expect(result.status).toBe(RmaStatus.QC_COMPLETE);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-09 + WKFL-04: resolve: Finance gate blocks then allows
  // ---------------------------------------------------------------------------

  describe('LCYC-09 + WKFL-04: resolve — Finance gate blocks then allows', () => {
    it('resolve() before Finance approval throws BadRequestException (WKFL-04 Finance gate)', async () => {
      const rma = await getQcCompleteWithCredit();

      // WKFL-04: resolve() must throw when CREDIT line is unapproved
      await expect(rmaService.resolve(rma.id, financeActor)).rejects.toThrow(BadRequestException);

      // RMA must remain QC_COMPLETE
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.QC_COMPLETE);
    });

    it('approveLineCredit() then resolve() succeeds — LCYC-09 transitions QC_COMPLETE → RESOLVED', async () => {
      const rma = await getQcCompleteWithCredit();
      const creditLine = rma.lines.find((l) => l.disposition === DispositionType.CREDIT);
      expect(creditLine).not.toBeUndefined();

      // WKFL-04: Finance approves the CREDIT line
      await rmaService.approveLineCredit(rma.id, creditLine!.id, financeActor);

      // LCYC-09: resolve() now succeeds
      const resolved = await rmaService.resolve(rma.id, financeActor);
      expect(resolved.status).toBe(RmaStatus.RESOLVED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-10: close transitions RESOLVED → CLOSED
  // ---------------------------------------------------------------------------

  describe('LCYC-10: close transitions RESOLVED → CLOSED', () => {
    it('transitions status from RESOLVED to CLOSED', async () => {
      const rma = await getQcCompleteWithCredit();
      const creditLine = rma.lines.find((l) => l.disposition === DispositionType.CREDIT);
      expect(creditLine).not.toBeUndefined();

      // Advance to RESOLVED
      await rmaService.approveLineCredit(rma.id, creditLine!.id, financeActor);
      await rmaService.resolve(rma.id, financeActor);

      // LCYC-10: close succeeds
      const closed = await rmaService.close(rma.id, agentActor);
      expect(closed.status).toBe(RmaStatus.CLOSED);
    });
  });

  // ---------------------------------------------------------------------------
  // LCYC-11: cancel with required reason
  // ---------------------------------------------------------------------------

  describe('LCYC-11: cancel with required reason', () => {
    it('transitions DRAFT → CANCELLED when cancellationReason is provided', async () => {
      const rma = await createDraftRma();
      const result = await rmaService.cancel(
        rma.id,
        { cancellationReason: 'Customer withdrew' },
        agentActor,
      );
      expect(result.status).toBe(RmaStatus.CANCELLED);
    });

    it('cancel without reason throws BadRequestException (reason is required)', async () => {
      const rma = await createDraftRma();
      await expect(
        rmaService.cancel(rma.id, { cancellationReason: '' }, agentActor),
      ).rejects.toThrow(BadRequestException);

      // RMA must remain DRAFT
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.DRAFT);
    });

    it('transitions SUBMITTED → CANCELLED when cancellationReason is provided', async () => {
      const rma = await getSubmittedRma();
      const result = await rmaService.cancel(
        rma.id,
        { cancellationReason: 'Duplicate submission' },
        agentActor,
      );
      expect(result.status).toBe(RmaStatus.CANCELLED);
    });

    it('transitions APPROVED → CANCELLED when cancellationReason is provided', async () => {
      const rma = await getApprovedRma();
      const result = await rmaService.cancel(
        rma.id,
        { cancellationReason: 'Order cancelled by supplier' },
        agentActor,
      );
      expect(result.status).toBe(RmaStatus.CANCELLED);
    });
  });

  // ---------------------------------------------------------------------------
  // LINE-01: addLine and removeLine CRUD; both blocked after SUBMITTED
  // ---------------------------------------------------------------------------

  describe('LINE-01: addLine and removeLine CRUD', () => {
    it('addLine adds a new line to a DRAFT RMA', async () => {
      const rma = await createDraftRma();
      expect(rma.lines).toHaveLength(1);

      const result = await rmaService.addLine(
        rma.id,
        { partNumber: 'P-002', orderedQty: 1, reasonCode: 'WRONG_ITEM' },
        agentActor,
      );

      expect(result.lines).toHaveLength(2);
      const addedLine = result.lines.find((l) => l.partNumber === 'P-002');
      expect(addedLine).not.toBeUndefined();
      expect(addedLine!.orderedQty).toBe(1);
    });

    it('removeLine removes a line from a DRAFT RMA', async () => {
      const rma = await createDraftRma();

      // Add a second line to remove
      const withTwoLines = await rmaService.addLine(
        rma.id,
        { partNumber: 'P-003', orderedQty: 2, reasonCode: 'WRONG_ITEM' },
        agentActor,
      );
      expect(withTwoLines.lines).toHaveLength(2);
      const lineToRemove = withTwoLines.lines.find((l) => l.partNumber === 'P-003')!;

      const result = await rmaService.removeLine(rma.id, lineToRemove.id, agentActor);
      expect(result.lines).toHaveLength(1);
      expect(result.lines.find((l) => l.id === lineToRemove.id)).toBeUndefined();
    });

    it('addLine is blocked after SUBMITTED (lines locked after submission)', async () => {
      const rma = await getSubmittedRma();

      await expect(
        rmaService.addLine(
          rma.id,
          { partNumber: 'P-BLOCKED', orderedQty: 1, reasonCode: 'DEFECTIVE' },
          agentActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('removeLine is blocked after SUBMITTED (lines locked after submission)', async () => {
      const rma = await getSubmittedRma();
      const lineId = rma.lines[0].id;

      await expect(
        rmaService.removeLine(rma.id, lineId, agentActor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // LINE-02: updateLine sets disposition; disposition lock triggers after qcInspectedAt set
  // ---------------------------------------------------------------------------

  describe('LINE-02: updateLine sets disposition; disposition lock after qcInspectedAt', () => {
    it('updateLine sets disposition on a DRAFT RMA line', async () => {
      const rma = await createDraftRma();
      const lineId = rma.lines[0].id;

      const result = await rmaService.updateLine(
        rma.id,
        lineId,
        { disposition: 'CREDIT' },
        agentActor,
      );

      expect(result.lines[0].disposition).toBe(DispositionType.CREDIT);
    });

    it('disposition is locked after qcInspectedAt is set (LINE-02 disposition lock)', async () => {
      // Create a DRAFT RMA and set disposition — line is still editable in DRAFT
      const rma = await createDraftRma();
      const lineId = rma.lines[0].id;

      // Set initial disposition to CREDIT
      await rmaService.updateLine(rma.id, lineId, { disposition: 'CREDIT' }, agentActor);

      // Directly set qcInspectedAt via prisma to simulate QC inspection lock
      // (service normally only sets this in RECEIVED status, but service enforces
      // the lock purely on qcInspectedAt being non-null regardless of status)
      await prisma.rmaLine.update({
        where: { id: lineId },
        data: { qcInspectedAt: new Date() },
      });

      // Attempt to change disposition — must throw BadRequestException (disposition locked)
      await expect(
        rmaService.updateLine(rma.id, lineId, { disposition: 'SCRAP' }, agentActor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Branch isolation (FOUND-03): findByIdBranchScoped returns null for cross-branch
  // ---------------------------------------------------------------------------

  describe('Branch isolation: findByIdBranchScoped returns null for cross-branch RMAs', () => {
    it('findByIdBranchScoped returns null when RMA belongs to a different branch', async () => {
      // Create an RMA in branchA
      const rma = await createDraftRma(branchA.id);

      // branchB context tries to fetch branchA's RMA — must get null (not 403)
      const result = await rmaRepository.findByIdBranchScoped(rma.id, branchBContext);
      expect(result).toBeNull();
    });

    it('findManyBranchScoped does not return branchA RMAs when scoped to branchB', async () => {
      // Create an RMA in branchA
      const rma = await createDraftRma(branchA.id);

      // branchB context lists RMAs — must not contain the branchA RMA
      const results = await rmaRepository.findManyBranchScoped(branchBContext);
      const ids = results.map((r) => r.id);
      expect(ids).not.toContain(rma.id);
    });

    it('findByIdBranchScoped returns the RMA when queried with matching branch context', async () => {
      // Positive assertion: same branch context can fetch the RMA
      const rma = await createDraftRma(branchA.id);

      const result = await rmaRepository.findByIdBranchScoped(rma.id, agentContext);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(rma.id);
    });
  });
});
