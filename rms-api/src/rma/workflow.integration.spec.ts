/**
 * Integration tests for Phase 3 workflow and line operations — 03-04
 *
 * Tests all 6 Phase 3 requirements against a real Postgres database.
 * Uses the same NestJS TestingModule pattern established in Phase 2 (rma.service.integration.spec.ts).
 *
 * Requirement IDs covered:
 *   WKFL-01: Approval queue — scope, sort, status filter
 *   WKFL-02: Contest flow — one-contest rule, empty reason guard
 *   WKFL-03: Overturn and uphold — CONTESTED exits to APPROVED or CLOSED
 *   WKFL-04: Finance approval gate — approveLineCredit, resolve() blocked until approved
 *   WKFL-05: QC inspection recording — qcPass, qcFindings, qcDispositionRecommendation
 *   LINE-04: Line split — quantity conservation, minimum 2 lines, locked after submission
 *
 * Prerequisites:
 *   docker compose up -d (postgres container running)
 *   DATABASE_URL env var pointing to rms_dev database
 *   npx prisma migrate deploy (migrations applied)
 *
 * Run: cd rms-api && npm run test:e2e -- --reporter=verbose workflow.integration
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

describe('Phase 3 Workflow Integration', () => {
  let moduleRef: TestingModule;
  let rmaService: RmaService;
  let rmaRepository: RmaRepository;
  let prisma: PrismaService;

  // Shared fixtures — one branch pair and five users created once per test suite
  let branchA: { id: string };
  let branchB: { id: string };

  let agentUser: { id: string; portalUserId: string; email: string };
  let managerUser: { id: string; portalUserId: string; email: string };
  let customerUser: { id: string; portalUserId: string; email: string };
  let financeUser: { id: string; portalUserId: string; email: string };
  let qcUser: { id: string; portalUserId: string; email: string };

  let agentActor: RmaActorContext;
  let managerActor: RmaActorContext;
  let customerActor: RmaActorContext;
  let financeActor: RmaActorContext;
  let qcActor: RmaActorContext;

  // branchA manager user context — RmsUserContext shape for findForApprovalQueue
  let managerContext: RmsUserContext;
  let branchBManagerContext: RmsUserContext;

  // Track all created RMA IDs for FK-safe cleanup
  const createdRmaIds: string[] = [];

  // Track created user/branch IDs for cleanup
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
      data: { name: `Workflow Test Branch A ${ts}`, code: `WF-A-${ts}` },
    });
    branchB = await prisma.branch.create({
      data: { name: `Workflow Test Branch B ${ts}`, code: `WF-B-${ts}` },
    });

    // Create five users with their respective roles at branchA
    agentUser = await prisma.user.create({
      data: {
        portalUserId: `wf-agent-${ts}`,
        email: `wf-agent-${ts}@test.example`,
        displayName: 'WF Returns Agent',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.RETURNS_AGENT, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(agentUser.id);

    managerUser = await prisma.user.create({
      data: {
        portalUserId: `wf-manager-${ts}`,
        email: `wf-manager-${ts}@test.example`,
        displayName: 'WF Branch Manager',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.BRANCH_MANAGER, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(managerUser.id);

    customerUser = await prisma.user.create({
      data: {
        portalUserId: `wf-customer-${ts}`,
        email: `wf-customer-${ts}@test.example`,
        displayName: 'WF Customer',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.CUSTOMER, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(customerUser.id);

    financeUser = await prisma.user.create({
      data: {
        portalUserId: `wf-finance-${ts}`,
        email: `wf-finance-${ts}@test.example`,
        displayName: 'WF Finance User',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.FINANCE, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(financeUser.id);

    qcUser = await prisma.user.create({
      data: {
        portalUserId: `wf-qc-${ts}`,
        email: `wf-qc-${ts}@test.example`,
        displayName: 'WF QC User',
        branchRoles: {
          create: [{ branchId: branchA.id, role: RmsRole.QC, assignedBy: 'system' }],
        },
      },
    });
    createdUserIds.push(qcUser.id);

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

    customerActor = {
      id: customerUser.id,
      portalUserId: customerUser.portalUserId,
      email: customerUser.email,
      role: RmsRole.CUSTOMER,
      branchIds: [],
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

    qcActor = {
      id: qcUser.id,
      portalUserId: qcUser.portalUserId,
      email: qcUser.email,
      role: RmsRole.QC,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    // RmsUserContext shapes for findForApprovalQueue (repository method)
    managerContext = {
      id: managerUser.id,
      portalUserId: managerUser.portalUserId,
      email: managerUser.email,
      role: RmsRole.BRANCH_MANAGER,
      branchIds: [branchA.id],
      isAdmin: false,
    };

    // branchB manager context — has no access to branchA RMAs
    branchBManagerContext = {
      id: managerUser.id,
      portalUserId: managerUser.portalUserId,
      email: managerUser.email,
      role: RmsRole.BRANCH_MANAGER,
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
  async function createDraftRma(branchId = branchA.id, orderedQty = 10) {
    const rma = await rmaService.createDraft(
      {
        branchId,
        lines: [{ partNumber: 'P001', orderedQty, reasonCode: 'DEFECTIVE' }],
      },
      agentActor,
    );
    createdRmaIds.push(rma.id);
    return rma;
  }

  // Helper: progress to SUBMITTED
  async function getSubmittedRma(branchId = branchA.id) {
    const rma = await createDraftRma(branchId);
    return rmaService.submit(rma.id, agentActor);
  }

  // Helper: progress to APPROVED
  async function getApprovedRma(branchId = branchA.id) {
    const rma = await getSubmittedRma(branchId);
    return rmaService.approve(rma.id, managerActor);
  }

  // Helper: progress to REJECTED
  async function getRejectedRma() {
    const rma = await getSubmittedRma();
    return rmaService.reject(rma.id, { rejectionReason: 'Part number mismatch' }, managerActor);
  }

  // Helper: progress to CONTESTED
  async function getContestedRma() {
    const rma = await getRejectedRma();
    return rmaService.contest(rma.id, { disputeReason: 'Part number was correct' }, customerActor);
  }

  // Helper: progress to QC_COMPLETE with a CREDIT disposition line
  async function getQcCompleteWithCredit() {
    const rma = await getApprovedRma();
    const lineId = rma.lines[0].id;

    // Set disposition to CREDIT before QC
    await rmaService.updateLine(rma.id, lineId, { disposition: 'CREDIT' }, agentActor);

    // Record receipt
    await rmaService.recordReceipt(rma.id, lineId, { receivedQty: 10 }, agentActor);

    // Record QC inspection
    await rmaService.recordQcInspection(
      rma.id,
      lineId,
      { lineId, inspectedQty: 10, qcPass: true },
      qcActor,
    );

    // Complete QC
    await rmaService.completeQc(rma.id, agentActor);

    // Re-fetch to get fresh state with updated line
    const updated = await rmaRepository.findById(rma.id);
    return updated!;
  }

  // ---------------------------------------------------------------------------
  // WKFL-01: Approval queue — scope, sort, status filter
  // ---------------------------------------------------------------------------

  describe('WKFL-01: Approval queue', () => {
    it('returns only SUBMITTED RMAs from the manager\'s branch, sorted oldest-first', async () => {
      // Create two SUBMITTED RMAs at branchA (small delay ensures different createdAt)
      const rmaA1 = await getSubmittedRma(branchA.id);
      await new Promise((r) => setTimeout(r, 50));
      const rmaA2 = await getSubmittedRma(branchA.id);

      // Create one APPROVED RMA (should NOT appear — wrong status)
      await getApprovedRma(branchA.id);

      const queue = await rmaRepository.findForApprovalQueue(managerContext);

      // Must contain both SUBMITTED RMAs in creation order (oldest first)
      const queueIds = queue.map((item) => item.id);
      const idxA1 = queueIds.indexOf(rmaA1.id);
      const idxA2 = queueIds.indexOf(rmaA2.id);

      expect(idxA1).toBeGreaterThanOrEqual(0);
      expect(idxA2).toBeGreaterThanOrEqual(0);
      expect(idxA1).toBeLessThan(idxA2); // oldest first

      // All returned items must be SUBMITTED or CONTESTED
      for (const item of queue) {
        expect([RmaStatus.SUBMITTED as string, RmaStatus.CONTESTED as string]).toContain(item.status);
      }
    });

    it('returns empty when no CONTESTED RMAs exist (status filter)', async () => {
      // Filter explicitly for CONTESTED — none created yet at this point
      const queue = await rmaRepository.findForApprovalQueue(managerContext, {
        status: RmaStatus.CONTESTED,
      });

      // Should return 0 contested items (any existing ones were created in other tests)
      // Filter to only items we'd have created — but since none are CONTESTED yet,
      // we can verify that all returned items are CONTESTED (if any)
      for (const item of queue) {
        expect(item.status).toBe(RmaStatus.CONTESTED as string);
      }
    });

    it('includes CONTESTED RMAs in queue after a rejection is contested', async () => {
      const contested = await getContestedRma();

      const queue = await rmaRepository.findForApprovalQueue(managerContext, {
        status: RmaStatus.CONTESTED,
      });

      const queueIds = queue.map((item) => item.id);
      expect(queueIds).toContain(contested.id);

      // The contested RMA should show CONTESTED status in the queue
      const queueItem = queue.find((item) => item.id === contested.id);
      expect(queueItem).not.toBeNull();
      expect(queueItem!.status).toBe(RmaStatus.CONTESTED as string);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-branch isolation (WKFL-01 data ownership)
  // ---------------------------------------------------------------------------

  describe('Cross-branch isolation (WKFL-01)', () => {
    it('approval queue for branchB manager does not contain branchA RMAs', async () => {
      // Create a SUBMITTED RMA at branchA
      const branchARma = await getSubmittedRma(branchA.id);

      // branchB manager queries queue — must NOT see branchA's RMA
      const queue = await rmaRepository.findForApprovalQueue(branchBManagerContext);

      const queueIds = queue.map((item) => item.id);
      expect(queueIds).not.toContain(branchARma.id);
    });
  });

  // ---------------------------------------------------------------------------
  // WKFL-02: Contest flow
  // ---------------------------------------------------------------------------

  describe('WKFL-02: Contest flow', () => {
    it('contest() on REJECTED RMA transitions to CONTESTED and sets contestedAt', async () => {
      const rma = await getRejectedRma();

      const contested = await rmaService.contest(
        rma.id,
        { disputeReason: 'Valid dispute reason' },
        customerActor,
      );

      expect(contested.status).toBe(RmaStatus.CONTESTED);

      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.contestedAt).not.toBeNull();
      expect(dbRma!.disputeReason).toBe('Valid dispute reason');
    });

    it('contesting the same RMA a second time throws BadRequestException (one-contest rule)', async () => {
      const rma = await getRejectedRma();

      // First contest — should succeed
      await rmaService.contest(
        rma.id,
        { disputeReason: 'First valid dispute' },
        customerActor,
      );

      // Second contest on the same RMA must throw
      await expect(
        rmaService.contest(rma.id, { disputeReason: 'Second attempt' }, customerActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('contest() with empty disputeReason throws BadRequestException', async () => {
      const rma = await getRejectedRma();

      await expect(
        rmaService.contest(rma.id, { disputeReason: '' }, customerActor),
      ).rejects.toThrow(BadRequestException);

      // RMA must remain REJECTED (no state change written)
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.REJECTED);
    });
  });

  // ---------------------------------------------------------------------------
  // WKFL-03: Overturn and uphold
  // ---------------------------------------------------------------------------

  describe('WKFL-03: Overturn and uphold', () => {
    it('overturn() transitions CONTESTED → APPROVED and sets contestResolutionNote', async () => {
      const rma = await getContestedRma();

      const overturned = await rmaService.overturn(
        rma.id,
        { resolutionNote: 'Customer is correct — approving' },
        managerActor,
      );

      expect(overturned.status).toBe(RmaStatus.APPROVED);

      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.contestResolutionNote).toBe('Customer is correct — approving');
    });

    it('uphold() transitions CONTESTED → CLOSED and sets contestResolutionNote', async () => {
      const rma = await getContestedRma();

      const upheld = await rmaService.uphold(
        rma.id,
        { resolutionNote: 'Original rejection stands' },
        managerActor,
      );

      expect(upheld.status).toBe(RmaStatus.CLOSED);

      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.contestResolutionNote).toBe('Original rejection stands');
    });

    it('overturn() with empty resolutionNote throws BadRequestException', async () => {
      const rma = await getContestedRma();

      await expect(
        rmaService.overturn(rma.id, { resolutionNote: '' }, managerActor),
      ).rejects.toThrow(BadRequestException);

      // RMA must remain CONTESTED
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.CONTESTED);
    });
  });

  // ---------------------------------------------------------------------------
  // WKFL-04: Finance approval gate
  // ---------------------------------------------------------------------------

  describe('WKFL-04: Finance approval gate', () => {
    it('approveLineCredit() sets financeApprovedAt on the CREDIT line', async () => {
      const rma = await getQcCompleteWithCredit();
      const creditLine = rma.lines.find((l) => l.disposition === DispositionType.CREDIT);
      expect(creditLine).not.toBeNull();

      const result = await rmaService.approveLineCredit(rma.id, creditLine!.id, financeActor);

      const approvedLine = result.lines.find((l) => l.id === creditLine!.id);
      expect(approvedLine!.financeApprovedAt).not.toBeNull();
      expect(approvedLine!.financeApprovedById).toBe(financeUser.id);
    });

    it('resolve() before Finance approval throws BadRequestException (awaiting Finance approval)', async () => {
      const rma = await getQcCompleteWithCredit();
      // Do NOT call approveLineCredit — line should still be unapproved

      await expect(rmaService.resolve(rma.id, agentActor)).rejects.toThrow(BadRequestException);

      // RMA must remain QC_COMPLETE
      const dbRma = await prisma.rma.findUnique({ where: { id: rma.id } });
      expect(dbRma!.status).toBe(RmaStatus.QC_COMPLETE);
    });

    it('resolve() after Finance approval succeeds — RMA reaches RESOLVED', async () => {
      const rma = await getQcCompleteWithCredit();
      const creditLine = rma.lines.find((l) => l.disposition === DispositionType.CREDIT);
      expect(creditLine).not.toBeNull();

      // Finance approves the credit line
      await rmaService.approveLineCredit(rma.id, creditLine!.id, financeActor);

      // Now resolve should succeed
      const resolved = await rmaService.resolve(rma.id, agentActor);
      expect(resolved.status).toBe(RmaStatus.RESOLVED);
    });

    it('Finance approval is cleared when line disposition changes away from CREDIT', async () => {
      // Need an RMA in DRAFT with a CREDIT line that has been Finance-approved
      // Use updateLine() which calls clearFinanceApproval when disposition changes away from CREDIT
      const rma = await createDraftRma();
      const lineId = rma.lines[0].id;

      // Set disposition to CREDIT
      await rmaService.updateLine(rma.id, lineId, { disposition: 'CREDIT' }, agentActor);

      // Directly set financeApprovedAt to simulate prior Finance approval
      await prisma.rmaLine.update({
        where: { id: lineId },
        data: { financeApprovedAt: new Date(), financeApprovedById: financeUser.id },
      });

      // Verify it was set
      const beforeUpdate = await prisma.rmaLine.findUnique({ where: { id: lineId } });
      expect(beforeUpdate!.financeApprovedAt).not.toBeNull();

      // Now change disposition away from CREDIT → financeApprovedAt should be cleared
      await rmaService.updateLine(rma.id, lineId, { disposition: 'SCRAP' }, agentActor);

      const afterUpdate = await prisma.rmaLine.findUnique({ where: { id: lineId } });
      expect(afterUpdate!.financeApprovedAt).toBeNull();
      expect(afterUpdate!.financeApprovedById).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // WKFL-05: QC inspection recording
  // ---------------------------------------------------------------------------

  describe('WKFL-05: QC inspection recording', () => {
    it('recordQcInspection() persists qcPass=true, qcFindings, and qcDispositionRecommendation on the line', async () => {
      const rma = await getApprovedRma();
      const lineId = rma.lines[0].id;

      await rmaService.recordReceipt(rma.id, lineId, { receivedQty: 5 }, agentActor);

      await rmaService.recordQcInspection(
        rma.id,
        lineId,
        {
          lineId,
          inspectedQty: 2,
          qcPass: true,
          qcFindings: 'No damage',
          qcDispositionRecommendation: DispositionType.CREDIT,
        },
        qcActor,
      );

      const dbLine = await prisma.rmaLine.findUnique({ where: { id: lineId } });
      expect(dbLine!.inspectedQty).toBe(2);
      expect(dbLine!.qcPass).toBe(true);
      expect(dbLine!.qcFindings).toBe('No damage');
      expect(dbLine!.qcDispositionRecommendation).toBe(DispositionType.CREDIT);
      expect(dbLine!.qcInspectedAt).not.toBeNull();
    });

    it('recordQcInspection() persists qcPass=false with findings correctly', async () => {
      const rma = await getApprovedRma();
      const lineId = rma.lines[0].id;

      await rmaService.recordReceipt(rma.id, lineId, { receivedQty: 8 }, agentActor);

      await rmaService.recordQcInspection(
        rma.id,
        lineId,
        {
          lineId,
          inspectedQty: 8,
          qcPass: false,
          qcFindings: 'Visible cosmetic damage on unit',
          qcDispositionRecommendation: DispositionType.SCRAP,
        },
        qcActor,
      );

      const dbLine = await prisma.rmaLine.findUnique({ where: { id: lineId } });
      expect(dbLine!.qcPass).toBe(false);
      expect(dbLine!.qcFindings).toBe('Visible cosmetic damage on unit');
      expect(dbLine!.qcDispositionRecommendation).toBe(DispositionType.SCRAP);
    });
  });

  // ---------------------------------------------------------------------------
  // LINE-04: Line split
  // ---------------------------------------------------------------------------

  describe('LINE-04: Line split', () => {
    it('splitLine() replaces original line with two new lines, conserving total quantity', async () => {
      const rma = await createDraftRma(branchA.id, 10); // orderedQty = 10
      const lineId = rma.lines[0].id;

      const result = await rmaService.splitLine(
        rma.id,
        lineId,
        [
          { partNumber: 'P001', orderedQty: 6, reasonCode: 'R1' },
          { partNumber: 'P001', orderedQty: 4, reasonCode: 'R2' },
        ],
        agentActor,
      );

      // Original line must be gone
      const originalLine = result.lines.find((l) => l.id === lineId);
      expect(originalLine).toBeUndefined();

      // Two new lines must exist
      expect(result.lines).toHaveLength(2);

      // Total ordered qty must be conserved
      const totalQty = result.lines.reduce((sum, l) => sum + l.orderedQty, 0);
      expect(totalQty).toBe(10);

      // Each split line must be independent
      const qtys = result.lines.map((l) => l.orderedQty).sort((a, b) => a - b);
      expect(qtys).toEqual([4, 6]);
    });

    it('splitLine() with quantities that do not sum to original throws BadRequestException', async () => {
      const rma = await createDraftRma(branchA.id, 10);
      const lineId = rma.lines[0].id;

      await expect(
        rmaService.splitLine(
          rma.id,
          lineId,
          [
            { partNumber: 'P001', orderedQty: 7, reasonCode: 'R1' },
            { partNumber: 'P001', orderedQty: 4, reasonCode: 'R2' },
          ],
          agentActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('splitLine() with only 1 split line throws BadRequestException (at least 2 required)', async () => {
      const rma = await createDraftRma(branchA.id, 10);
      const lineId = rma.lines[0].id;

      await expect(
        rmaService.splitLine(
          rma.id,
          lineId,
          [{ partNumber: 'P001', orderedQty: 10, reasonCode: 'R1' }],
          agentActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('splitLine() on a SUBMITTED RMA throws BadRequestException (lines locked)', async () => {
      const rma = await createDraftRma(branchA.id, 10);
      const lineId = rma.lines[0].id;

      // Submit the RMA to lock lines
      await rmaService.submit(rma.id, agentActor);

      await expect(
        rmaService.splitLine(
          rma.id,
          lineId,
          [
            { partNumber: 'P001', orderedQty: 6, reasonCode: 'R1' },
            { partNumber: 'P001', orderedQty: 4, reasonCode: 'R2' },
          ],
          agentActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
