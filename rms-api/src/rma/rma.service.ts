import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.types.js';
import { RmaRepository, RmaWithLines } from './rma.repository.js';
import { assertValidTransition } from './rma-lifecycle.js';
import { RmaStatus } from '../../generated/prisma/enums.js';
import { DispositionType } from '../../generated/prisma/client.js';
import {
  RmaActorContext,
  CreateRmaInput,
  LineInput,
  UpdateLineInput,
  CancelRmaInput,
  PlaceInfoRequiredInput,
  RecordReceiptInput,
  ContestInput,
  OverturnInput,
  UpholdInput,
  SplitLineInput,
  RecordQcInspectionInput,
} from './rma.types.js';

// Statuses in which line mutations (add/edit/remove) are permitted
const LINE_EDITABLE_STATUSES: RmaStatus[] = [RmaStatus.DRAFT, RmaStatus.INFO_REQUIRED];

@Injectable()
export class RmaService {
  constructor(
    @Inject(PrismaService)  private readonly prisma: PrismaService,
    @Inject(AuditService)   private readonly auditService: AuditService,
    @Inject(RmaRepository)  private readonly rmaRepository: RmaRepository,
  ) {}

  // ----------------------------------------------------------------
  // LCYC-01 + LINE-01: Create Draft RMA with initial line items
  // ----------------------------------------------------------------
  async createDraft(input: CreateRmaInput, actor: RmaActorContext): Promise<RmaWithLines> {
    if (!input.lines || input.lines.length === 0) {
      throw new BadRequestException('At least one line item is required to create an RMA');
    }

    const rmaNumber = await this.rmaRepository.generateRmaNumber();

    return this.prisma.$transaction(async (tx) => {
      const rma = await this.rmaRepository.createRma(tx, {
        rmaNumber,
        branchId: input.branchId,
        customerId: input.customerId,
        submittedById: actor.id,
        lines: input.lines,
      });

      await this.auditService.logEvent(tx, {
        rmaId: rma.id,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_CREATED,
        toStatus: RmaStatus.DRAFT,
        newValue: { rmaNumber: rma.rmaNumber, lineCount: rma.lines.length },
      });

      return rma;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-02: Submit a Draft RMA
  // ----------------------------------------------------------------
  async submit(rmaId: string, actor: RmaActorContext): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.SUBMITTED);

    // Guard: must have at least one line before submitting
    if (rma.lines.length === 0) {
      throw new BadRequestException('Cannot submit an RMA with no line items');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.SUBMITTED);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_SUBMITTED,
        fromStatus: rma.status,
        toStatus: RmaStatus.SUBMITTED,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-05: Place RMA in Info Required
  // ----------------------------------------------------------------
  async placeInfoRequired(
    rmaId: string,
    input: PlaceInfoRequiredInput,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.INFO_REQUIRED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.INFO_REQUIRED);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_INFO_REQUIRED,
        fromStatus: rma.status,
        toStatus: RmaStatus.INFO_REQUIRED,
        newValue: input.infoRequestNote ? { note: input.infoRequestNote } : undefined,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-06: Resubmit from Info Required back to Submitted
  // ----------------------------------------------------------------
  async resubmit(rmaId: string, actor: RmaActorContext): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.SUBMITTED);

    // Guard: must still have at least one line
    if (rma.lines.length === 0) {
      throw new BadRequestException('Cannot resubmit an RMA with no line items');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.SUBMITTED);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_SUBMITTED,
        fromStatus: rma.status,
        toStatus: RmaStatus.SUBMITTED,
        metadata: { cycle: 'resubmit' },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-11: Cancel an RMA (DRAFT | SUBMITTED | APPROVED | INFO_REQUIRED)
  // ----------------------------------------------------------------
  async cancel(
    rmaId: string,
    input: CancelRmaInput,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    if (!input.cancellationReason || input.cancellationReason.trim().length === 0) {
      throw new BadRequestException('Cancellation reason is required');
    }

    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.CANCELLED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateRma(tx, rmaId, {
        status: RmaStatus.CANCELLED,
        cancellationReason: input.cancellationReason.trim(),
      });

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_CANCELLED,
        fromStatus: rma.status,
        toStatus: RmaStatus.CANCELLED,
        newValue: { cancellationReason: input.cancellationReason.trim() },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LINE-01: Add a line to an RMA in DRAFT or INFO_REQUIRED
  // ----------------------------------------------------------------
  async addLine(
    rmaId: string,
    line: LineInput,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    if (!LINE_EDITABLE_STATUSES.includes(rma.status)) {
      throw new BadRequestException(
        `Cannot add lines to an RMA in ${rma.status} status — lines are locked after submission`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.addLine(tx, rmaId, line);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.LINE_ADDED,
        newValue: { partNumber: line.partNumber, orderedQty: line.orderedQty },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LINE-01 / LINE-02: Update a line (including disposition — LINE-02)
  // ----------------------------------------------------------------
  async updateLine(
    rmaId: string,
    lineId: string,
    data: UpdateLineInput,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    if (!LINE_EDITABLE_STATUSES.includes(rma.status)) {
      throw new BadRequestException(
        `Cannot edit lines on an RMA in ${rma.status} status — lines are locked after submission`,
      );
    }

    const line = rma.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

    // LINE-02 guard: disposition locked after QC inspection on this specific line
    if (data.disposition !== undefined && line.qcInspectedAt !== null) {
      throw new BadRequestException(
        `Cannot update disposition on line ${lineId} — QC inspection has been recorded`,
      );
    }

    const isDispositionChange = data.disposition !== undefined;

    // Pitfall 3: if disposition is being changed away from CREDIT, clear Finance approval
    const clearFinanceApproval =
      data.disposition !== undefined &&
      data.disposition !== DispositionType.CREDIT;

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateLine(tx, lineId, data);

      // Clear Finance approval when disposition changes away from CREDIT
      if (clearFinanceApproval) {
        await tx.rmaLine.update({
          where: { id: lineId },
          data: { financeApprovedAt: null, financeApprovedById: null },
        });
      }

      await this.auditService.logEvent(tx, {
        rmaId,
        rmaLineId: lineId,
        actorId: actor.id,
        actorRole: actor.role,
        action: isDispositionChange ? AuditAction.DISPOSITION_SET : AuditAction.LINE_UPDATED,
        newValue: data as Record<string, unknown>,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LINE-01: Remove a line from an RMA in DRAFT or INFO_REQUIRED
  // ----------------------------------------------------------------
  async removeLine(
    rmaId: string,
    lineId: string,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    if (!LINE_EDITABLE_STATUSES.includes(rma.status)) {
      throw new BadRequestException(
        `Cannot remove lines from an RMA in ${rma.status} status — lines are locked after submission`,
      );
    }

    const line = rma.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.removeLine(tx, lineId);

      await this.auditService.logEvent(tx, {
        rmaId,
        rmaLineId: lineId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.LINE_UPDATED,
        oldValue: { partNumber: line.partNumber, orderedQty: line.orderedQty, removed: true },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-03: Approve a Submitted RMA
  // ----------------------------------------------------------------
  async approve(rmaId: string, actor: RmaActorContext): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.APPROVED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.APPROVED);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_APPROVED,
        fromStatus: rma.status,
        toStatus: RmaStatus.APPROVED,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-04: Reject a Submitted RMA with a required reason
  // ----------------------------------------------------------------
  async reject(
    rmaId: string,
    input: { rejectionReason: string },
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    if (!input.rejectionReason || input.rejectionReason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.REJECTED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateRma(tx, rmaId, {
        status: RmaStatus.REJECTED,
        rejectionReason: input.rejectionReason.trim(),
      });

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_REJECTED,
        fromStatus: rma.status,
        toStatus: RmaStatus.REJECTED,
        newValue: { rejectionReason: input.rejectionReason.trim() },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-07 + LINE-03: Record receipt on an Approved (or already Received) RMA line
  // ----------------------------------------------------------------
  async recordReceipt(
    rmaId: string,
    lineId: string,
    input: RecordReceiptInput,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    if (input.receivedQty < 0) {
      throw new BadRequestException('Received quantity cannot be negative');
    }

    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    // Receipt is valid in APPROVED (first receipt transitions) or RECEIVED (subsequent receipts)
    if (rma.status !== RmaStatus.APPROVED && rma.status !== RmaStatus.RECEIVED) {
      throw new BadRequestException(
        `Cannot record receipt on an RMA in ${rma.status} status — must be APPROVED or RECEIVED`,
      );
    }

    const line = rma.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

    // LINE-03 guard: receivedQty cannot be set below existing inspectedQty
    // (over-receipt above orderedQty IS allowed — CONTEXT.md locked decision)
    if (input.receivedQty < line.inspectedQty) {
      throw new BadRequestException(
        `Cannot set receivedQty to ${input.receivedQty} — it would be below the already-inspected quantity of ${line.inspectedQty}`,
      );
    }

    // LCYC-07: First-receipt detection — if ALL lines have receivedQty === 0,
    // this is the first receipt on the RMA; transition to RECEIVED in the same tx.
    // Check is done before the update to avoid TOCTOU (Pitfall 3 from RESEARCH.md).
    const isFirstReceipt = rma.status === RmaStatus.APPROVED &&
      rma.lines.every((l) => l.receivedQty === 0);

    return this.prisma.$transaction(async (tx) => {
      // Update the line quantity
      await this.rmaRepository.updateLineReceipt(tx, lineId, input.receivedQty);

      // If first receipt: transition RMA status to RECEIVED atomically
      if (isFirstReceipt) {
        assertValidTransition(rma.status, RmaStatus.RECEIVED);
        await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.RECEIVED);
      }

      await this.auditService.logEvent(tx, {
        rmaId,
        rmaLineId: lineId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_RECEIVED,
        fromStatus: isFirstReceipt ? rma.status : undefined,
        toStatus: isFirstReceipt ? RmaStatus.RECEIVED : undefined,
        newValue: { receivedQty: input.receivedQty, isFirstReceipt },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-08 + LINE-03: Record QC inspection on a Received RMA line
  // Phase 3 extended: accepts qcPass, qcFindings, qcDispositionRecommendation (WKFL-05)
  // ----------------------------------------------------------------
  async recordQcInspection(
    rmaId: string,
    lineId: string,
    input: RecordQcInspectionInput,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    if (rma.status !== RmaStatus.RECEIVED) {
      throw new BadRequestException(
        `Cannot record QC inspection on an RMA in ${rma.status} status — must be RECEIVED`,
      );
    }

    const line = rma.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

    // LINE-03 guard: inspectedQty cannot exceed receivedQty (CONTEXT.md locked decision)
    if (input.inspectedQty > line.receivedQty) {
      throw new BadRequestException(
        `Cannot inspect ${input.inspectedQty} units — only ${line.receivedQty} units received on this line`,
      );
    }

    if (input.inspectedQty < 0) {
      throw new BadRequestException('Inspected quantity cannot be negative');
    }

    return this.prisma.$transaction(async (tx) => {
      // Sets inspectedQty and qcInspectedAt (disposition lock trigger) plus Phase 3 QC result fields
      await tx.rmaLine.update({
        where: { id: lineId },
        data: {
          inspectedQty: input.inspectedQty,
          qcInspectedAt: new Date(),
          ...(input.qcPass !== undefined ? { qcPass: input.qcPass } : {}),
          ...(input.qcFindings !== undefined ? { qcFindings: input.qcFindings } : {}),
          ...(input.qcDispositionRecommendation !== undefined
            ? { qcDispositionRecommendation: input.qcDispositionRecommendation }
            : {}),
        },
      });

      await this.auditService.logEvent(tx, {
        rmaId,
        rmaLineId: lineId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.LINE_UPDATED,
        newValue: {
          inspectedQty: input.inspectedQty,
          ...(input.qcPass !== undefined ? { qcPass: input.qcPass } : {}),
          ...(input.qcFindings !== undefined ? { qcFindings: input.qcFindings } : {}),
          ...(input.qcDispositionRecommendation !== undefined
            ? { qcDispositionRecommendation: input.qcDispositionRecommendation }
            : {}),
        },
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-08 (completion): Transition RECEIVED → QC_COMPLETE
  // Called after QC staff have recorded inspection on all (or sufficient) lines.
  // ----------------------------------------------------------------
  async completeQc(rmaId: string, actor: RmaActorContext): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.QC_COMPLETE);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.QC_COMPLETE);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.STATUS_CHANGED,
        fromStatus: rma.status,
        toStatus: RmaStatus.QC_COMPLETE,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-09: Resolve a QC-complete RMA
  // WKFL-04: Finance approval gate — all CREDIT lines must be approved before resolving
  // ----------------------------------------------------------------
  async resolve(rmaId: string, actor: RmaActorContext): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.RESOLVED);

    // Finance approval gate — all CREDIT lines must be approved before resolving
    const unapprovedCreditLines = rma.lines.filter(
      (l) => l.disposition === DispositionType.CREDIT && (l.financeApprovedAt === null || l.financeApprovedAt === undefined),
    );
    if (unapprovedCreditLines.length > 0) {
      throw new BadRequestException(
        `Cannot resolve — ${unapprovedCreditLines.length} credit line(s) awaiting Finance approval`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.RESOLVED);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_RESOLVED,
        fromStatus: rma.status,
        toStatus: RmaStatus.RESOLVED,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LCYC-10: Close a Resolved RMA
  // ----------------------------------------------------------------
  async close(rmaId: string, actor: RmaActorContext): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.CLOSED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateStatus(tx, rmaId, RmaStatus.CLOSED);

      await this.auditService.logEvent(tx, {
        rmaId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.RMA_CLOSED,
        fromStatus: rma.status,
        toStatus: RmaStatus.CLOSED,
      });

      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // WKFL-02: Contest a Rejected RMA (REJECTED → CONTESTED)
  // "One contest per RMA" — contestedAt set on first contest and never cleared.
  // ----------------------------------------------------------------
  async contest(rmaId: string, input: ContestInput, actor: RmaActorContext): Promise<RmaWithLines> {
    if (!input.disputeReason || input.disputeReason.trim().length === 0) {
      throw new BadRequestException('Dispute reason is required');
    }
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    // "One contest per RMA" — service-layer rule (state machine alone is insufficient)
    // rma.contestedAt is set on the FIRST contest and never cleared
    if (rma.contestedAt !== null && rma.contestedAt !== undefined) {
      throw new BadRequestException('This RMA has already been contested once and cannot be contested again');
    }

    assertValidTransition(rma.status, RmaStatus.CONTESTED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateRma(tx, rmaId, {
        status: RmaStatus.CONTESTED,
        disputeReason: input.disputeReason.trim(),
        contestedAt: new Date(),
      });
      await this.auditService.logEvent(tx, {
        rmaId, actorId: actor.id, actorRole: actor.role,
        action: AuditAction.RMA_CONTESTED,
        fromStatus: rma.status, toStatus: RmaStatus.CONTESTED,
        newValue: { disputeReason: input.disputeReason.trim() },
      });
      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // WKFL-03: Overturn a contested decision (CONTESTED → APPROVED)
  // Branch Manager rules in favour of the customer — RMA proceeds to APPROVED.
  // ----------------------------------------------------------------
  async overturn(rmaId: string, input: OverturnInput, actor: RmaActorContext): Promise<RmaWithLines> {
    if (!input.resolutionNote || input.resolutionNote.trim().length === 0) {
      throw new BadRequestException('Resolution note is required');
    }
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.APPROVED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateRma(tx, rmaId, {
        status: RmaStatus.APPROVED,
        contestResolutionNote: input.resolutionNote.trim(),
      });
      await this.auditService.logEvent(tx, {
        rmaId, actorId: actor.id, actorRole: actor.role,
        action: AuditAction.RMA_APPROVED,
        fromStatus: rma.status, toStatus: RmaStatus.APPROVED,
        newValue: { resolutionNote: input.resolutionNote.trim(), overturned: true },
      });
      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // WKFL-03: Uphold a rejection decision (CONTESTED → CLOSED)
  // Branch Manager upholds the original rejection — RMA is closed.
  // ----------------------------------------------------------------
  async uphold(rmaId: string, input: UpholdInput, actor: RmaActorContext): Promise<RmaWithLines> {
    if (!input.resolutionNote || input.resolutionNote.trim().length === 0) {
      throw new BadRequestException('Resolution note is required');
    }
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    assertValidTransition(rma.status, RmaStatus.CLOSED);

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateRma(tx, rmaId, {
        status: RmaStatus.CLOSED,
        contestResolutionNote: input.resolutionNote.trim(),
      });
      await this.auditService.logEvent(tx, {
        rmaId, actorId: actor.id, actorRole: actor.role,
        action: AuditAction.RMA_CLOSED,
        fromStatus: rma.status, toStatus: RmaStatus.CLOSED,
        newValue: { resolutionNote: input.resolutionNote.trim(), upheld: true },
      });
      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // LINE-04: Split a single line into 2+ lines (quantity must be conserved)
  // Only valid when RMA is in LINE_EDITABLE_STATUSES (DRAFT or INFO_REQUIRED).
  // ----------------------------------------------------------------
  async splitLine(
    rmaId: string,
    lineId: string,
    splits: SplitLineInput[],
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    // Guard: minimum 2 lines required
    if (splits.length < 2) {
      throw new BadRequestException('Split must produce at least 2 lines');
    }
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    // Guard: LINE_EDITABLE_STATUSES (same guard as addLine/updateLine/removeLine)
    if (!LINE_EDITABLE_STATUSES.includes(rma.status)) {
      throw new BadRequestException(
        `Cannot split lines on an RMA in ${rma.status} status — lines are locked after submission`,
      );
    }

    const line = rma.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

    // Guard: quantity conservation — sum of splits must equal original orderedQty exactly
    const totalSplitQty = splits.reduce((sum, s) => sum + s.orderedQty, 0);
    if (totalSplitQty !== line.orderedQty) {
      throw new BadRequestException(
        `Split quantities must sum to ${line.orderedQty} (original ordered qty); got ${totalSplitQty}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Delete original line
      await tx.rmaLine.delete({ where: { id: lineId } });

      // Create replacement lines
      await tx.rmaLine.createMany({
        data: splits.map((s) => ({
          rmaId,
          partNumber: s.partNumber,
          orderedQty: s.orderedQty,
          reasonCode: s.reasonCode,
          disposition: s.disposition ?? null,
          receivedQty: 0,
          inspectedQty: 0,
        })),
      });

      await this.auditService.logEvent(tx, {
        rmaId,
        rmaLineId: lineId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.LINE_SPLIT,
        oldValue: { partNumber: line.partNumber, orderedQty: line.orderedQty, splitInto: splits.length },
        newValue: { splitLines: splits.map((s) => ({ partNumber: s.partNumber, orderedQty: s.orderedQty })) },
      });

      // createMany returns { count: N } — always re-fetch to return RmaWithLines
      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }

  // ----------------------------------------------------------------
  // WKFL-04: Finance approves a CREDIT line (line-level approval)
  // Only applicable to lines with disposition === CREDIT.
  // ----------------------------------------------------------------
  async approveLineCredit(
    rmaId: string,
    lineId: string,
    actor: RmaActorContext,
  ): Promise<RmaWithLines> {
    const rma = await this.rmaRepository.findById(rmaId);
    if (!rma) throw new NotFoundException(`RMA ${rmaId} not found`);

    const line = rma.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException(`Line ${lineId} not found on RMA ${rmaId}`);

    if (line.disposition !== DispositionType.CREDIT) {
      throw new BadRequestException(
        `Line ${lineId} does not have CREDIT disposition — Finance approval not applicable`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.rmaLine.update({
        where: { id: lineId },
        data: {
          financeApprovedAt: new Date(),
          financeApprovedById: actor.id,
        },
      });
      await this.auditService.logEvent(tx, {
        rmaId,
        rmaLineId: lineId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.FINANCE_APPROVED,
        newValue: { lineId, disposition: 'CREDIT', approvedBy: actor.id },
      });
      return this.rmaRepository.findById(rmaId) as Promise<RmaWithLines>;
    });
  }
}
