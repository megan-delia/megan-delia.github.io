import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditEventInput } from './audit.types.js';

@Injectable()
export class AuditService {
  // DESIGN CONSTRAINT: tx parameter is REQUIRED.
  // This signature enforces that logEvent() can only be called inside a
  // prisma.$transaction(async (tx) => { ... }) callback.
  // If tx is not available, the caller is not in a transaction — fix the caller.
  //
  // USAGE:
  //   return this.prisma.$transaction(async (tx) => {
  //     await tx.rma.update({ ... });                    // state change
  //     await this.auditService.logEvent(tx, { ... });  // audit (same tx)
  //   });
  async logEvent(tx: Prisma.TransactionClient, input: AuditEventInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        rmaId: input.rmaId,
        rmaLineId: input.rmaLineId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        oldValue: input.oldValue as Prisma.InputJsonValue,
        newValue: input.newValue as Prisma.InputJsonValue,
        metadata: input.metadata as Prisma.InputJsonValue,
        ipAddress: input.ipAddress,
        // occurredAt is @default(now()) — never let caller supply it
      },
    });
  }
}
