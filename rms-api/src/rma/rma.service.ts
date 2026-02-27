import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.types.js';
import { RmaRepository, RmaWithLines } from './rma.repository.js';
import { assertValidTransition } from './rma-lifecycle.js';
import { RmaStatus } from '../../generated/prisma/enums.js';
import {
  RmaActorContext,
  CreateRmaInput,
  LineInput,
  UpdateLineInput,
  CancelRmaInput,
  PlaceInfoRequiredInput,
  RecordReceiptInput,
  RecordQcInput,
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

    return this.prisma.$transaction(async (tx) => {
      await this.rmaRepository.updateLine(tx, lineId, data);

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
}
