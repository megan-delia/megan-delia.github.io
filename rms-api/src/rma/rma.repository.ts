import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, RmaStatus, DispositionType } from '../../generated/prisma/client.js';
import { LineInput, UpdateLineInput, ApprovalQueueItem, CreditApprovalQueueItem } from './rma.types.js';
import { RmsUserContext, branchScopeWhere } from '../users/users.service.js';

// Full Rma record with lines included — returned by most service reads
export type RmaWithLines = Prisma.RmaGetPayload<{ include: { lines: true } }>;

@Injectable()
export class RmaRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Find an RMA by ID, always including its lines.
   * Returns null (not throws) when not found — callers handle the null case.
   */
  async findById(id: string): Promise<RmaWithLines | null> {
    return this.prisma.rma.findUnique({
      where: { id },
      include: { lines: true },
    });
  }

  /**
   * Generate a unique, human-readable RMA number.
   * Format: RMA-YYYYMM-NNNNNN (zero-padded 6-digit sequence within the month).
   *
   * Uses COUNT(*) + 1 within the month prefix as the sequence.
   * On unique constraint violation (concurrent creation), caller retries.
   */
  async generateRmaNumber(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `RMA-${year}${month}-`;

    const count = await this.prisma.rma.count({
      where: { rmaNumber: { startsWith: prefix } },
    });

    return `${prefix}${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * Create an RMA with nested lines in a single round-trip.
   * Must be called inside a service $transaction — pass tx, not this.prisma.
   */
  async createRma(
    tx: Prisma.TransactionClient,
    data: {
      rmaNumber: string;
      branchId: string;
      customerId?: string;
      submittedById: string;
      lines: LineInput[];
    },
  ): Promise<RmaWithLines> {
    return tx.rma.create({
      data: {
        rmaNumber: data.rmaNumber,
        status: RmaStatus.DRAFT,
        branchId: data.branchId,
        customerId: data.customerId ?? null,
        submittedById: data.submittedById,
        lines: {
          create: data.lines.map((line) => ({
            partNumber: line.partNumber,
            orderedQty: line.orderedQty,
            reasonCode: line.reasonCode,
            disposition: (line.disposition as any) ?? null,
            receivedQty: 0,
            inspectedQty: 0,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /**
   * Update the RMA status field only.
   * Must be called inside a service $transaction — pass tx.
   */
  async updateStatus(
    tx: Prisma.TransactionClient,
    rmaId: string,
    status: RmaStatus,
  ): Promise<void> {
    await tx.rma.update({
      where: { id: rmaId },
      data: { status },
    });
  }

  /**
   * Update multiple Rma fields (used for rejectionReason, cancellationReason, etc.).
   * Must be called inside a service $transaction — pass tx.
   */
  async updateRma(
    tx: Prisma.TransactionClient,
    rmaId: string,
    data: Prisma.RmaUpdateInput,
  ): Promise<void> {
    await tx.rma.update({ where: { id: rmaId }, data });
  }

  /**
   * Add a line to an existing RMA.
   * Called when a Returns Agent adds lines during DRAFT or INFO_REQUIRED.
   * Must be called inside a service $transaction — pass tx.
   */
  async addLine(
    tx: Prisma.TransactionClient,
    rmaId: string,
    line: LineInput,
  ): Promise<void> {
    await tx.rmaLine.create({
      data: {
        rmaId,
        partNumber: line.partNumber,
        orderedQty: line.orderedQty,
        reasonCode: line.reasonCode,
        disposition: (line.disposition as any) ?? null,
        receivedQty: 0,
        inspectedQty: 0,
      },
    });
  }

  /**
   * Update fields on an existing line.
   * Called for disposition updates and field edits in DRAFT or INFO_REQUIRED.
   * Must be called inside a service $transaction — pass tx.
   */
  async updateLine(
    tx: Prisma.TransactionClient,
    lineId: string,
    data: UpdateLineInput,
  ): Promise<void> {
    await tx.rmaLine.update({
      where: { id: lineId },
      data: {
        ...(data.partNumber !== undefined && { partNumber: data.partNumber }),
        ...(data.orderedQty !== undefined && { orderedQty: data.orderedQty }),
        ...(data.reasonCode !== undefined && { reasonCode: data.reasonCode }),
        // disposition: undefined = no change; null = explicit clear
        ...(data.disposition !== undefined && {
          disposition: (data.disposition as any),
        }),
      },
    });
  }

  /**
   * Remove a line. Only valid in DRAFT or INFO_REQUIRED (service enforces).
   * Must be called inside a service $transaction — pass tx.
   */
  async removeLine(tx: Prisma.TransactionClient, lineId: string): Promise<void> {
    await tx.rmaLine.delete({ where: { id: lineId } });
  }

  /**
   * Update the received quantity on a line.
   * Over-receipt is explicitly allowed — no max check here (CONTEXT.md decision).
   * Must be called inside a service $transaction — pass tx.
   */
  async updateLineReceipt(
    tx: Prisma.TransactionClient,
    lineId: string,
    receivedQty: number,
  ): Promise<void> {
    await tx.rmaLine.update({
      where: { id: lineId },
      data: { receivedQty },
    });
  }

  /**
   * Record QC inspection on a line.
   * Sets inspectedQty and qcInspectedAt (the disposition lock trigger).
   * Must be called inside a service $transaction — pass tx.
   */
  async updateLineQc(
    tx: Prisma.TransactionClient,
    lineId: string,
    inspectedQty: number,
  ): Promise<void> {
    await tx.rmaLine.update({
      where: { id: lineId },
      data: {
        inspectedQty,
        qcInspectedAt: new Date(),
      },
    });
  }

  /**
   * WKFL-01: Approval queue — RMAs in SUBMITTED or CONTESTED status, scoped to user's branches.
   * Returns lightweight queue items (no full line data — just counts and totals).
   * Ordered FIFO (oldest first) for fair processing.
   */
  async findForApprovalQueue(
    user: RmsUserContext,
    options?: {
      branchId?: string;
      status?: RmaStatus;
      take?: number;
      skip?: number;
    },
  ): Promise<ApprovalQueueItem[]> {
    // Status filter: both SUBMITTED and CONTESTED unless caller requests one
    const statusFilter = options?.status
      ? [options.status]
      : [RmaStatus.SUBMITTED, RmaStatus.CONTESTED];

    // Branch filter: always start from branchScopeWhere(user) for ownership enforcement
    // If caller provides branchId, validate it is within the user's branches before narrowing
    const userBranchFilter = branchScopeWhere(user);
    const branchFilter =
      options?.branchId && (user.branchIds.includes(options.branchId) || user.branchIds.length === 0)
        ? { branchId: options.branchId }  // narrowed to one branch (user owns it)
        : userBranchFilter;               // all user's branches (or admin: no filter)

    const rows = await this.prisma.rma.findMany({
      where: {
        ...branchFilter,
        status: { in: statusFilter },
      },
      orderBy: { createdAt: 'asc' },     // FIFO — oldest first
      take: options?.take ?? 50,
      skip: options?.skip ?? 0,
      select: {
        id: true,
        rmaNumber: true,
        status: true,
        createdAt: true,
        customerId: true,
        submittedBy: { select: { displayName: true, email: true } },
        lines: { select: { orderedQty: true } },
        _count: { select: { lines: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      rmaNumber: r.rmaNumber,
      status: r.status as string,
      createdAt: r.createdAt,
      customerId: r.customerId ?? '',
      submittedByName: r.submittedBy?.displayName ?? null,
      submittedByEmail: r.submittedBy?.email ?? null,
      lineCount: r._count.lines,
      totalOrderedQty: r.lines.reduce((sum, l) => sum + l.orderedQty, 0),
    }));
  }

  /**
   * WKFL-04: Finance credit approval queue — lines with CREDIT disposition that have not
   * yet been approved by Finance, on RMAs in QC_COMPLETE status.
   * Scoped to user's branches via branchScopeWhere().
   */
  async findCreditApprovalLines(
    user: RmsUserContext,
    options?: { take?: number; skip?: number },
  ): Promise<CreditApprovalQueueItem[]> {
    const rows = await this.prisma.rmaLine.findMany({
      where: {
        disposition: DispositionType.CREDIT,
        financeApprovedAt: null,
        rma: {
          status: RmaStatus.QC_COMPLETE,
          ...branchScopeWhere(user),   // Finance users also scoped to their branch(es)
        },
      },
      orderBy: { rma: { createdAt: 'asc' } },
      take: options?.take ?? 100,
      skip: options?.skip ?? 0,
      select: {
        id: true,
        partNumber: true,
        orderedQty: true,
        disposition: true,
        rma: {
          select: {
            id: true,
            rmaNumber: true,
            status: true,
          },
        },
      },
    });

    return rows.map((l) => ({
      rmaId: l.rma.id,
      rmaNumber: l.rma.rmaNumber,
      lineId: l.id,
      partNumber: l.partNumber,
      orderedQty: l.orderedQty,
      disposition: l.disposition as string,
      rmaStatus: l.rma.status as string,
    }));
  }
}
