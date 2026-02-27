import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, RmaStatus } from '../../generated/prisma/client.js';
import { LineInput, UpdateLineInput } from './rma.types.js';

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
}
