import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MerpAdapter } from './merp-adapter.interface.js';
import { CreditMemoPayload, ReplacementOrderPayload, MerpResult } from './merp.types.js';

@Injectable()
export class MerpStubAdapter extends MerpAdapter {
  private readonly logger = new Logger(MerpStubAdapter.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult> {
    this.logger.log({ msg: 'MERP STUB: createCreditMemo', rmaId: payload.rmaId });

    const result: MerpResult = {
      success: true,
      referenceId: `STUB-CM-${Date.now()}`,
      status: 'STUB',
    };

    // Log every adapter call to MerpIntegrationLog for reconciliation
    await this.prisma.merpIntegrationLog.create({
      data: {
        rmaId: payload.rmaId,
        operationType: 'CREDIT_MEMO',
        requestPayload: payload as unknown as object,
        responsePayload: result as unknown as object,
        referenceId: result.referenceId,
        status: result.status,
      },
    });

    return result;
  }

  async createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult> {
    this.logger.log({ msg: 'MERP STUB: createReplacementOrder', rmaId: payload.rmaId });

    const result: MerpResult = {
      success: true,
      referenceId: `STUB-RO-${Date.now()}`,
      status: 'STUB',
    };

    await this.prisma.merpIntegrationLog.create({
      data: {
        rmaId: payload.rmaId,
        operationType: 'REPLACEMENT_ORDER',
        requestPayload: payload as unknown as object,
        responsePayload: result as unknown as object,
        referenceId: result.referenceId,
        status: result.status,
      },
    });

    return result;
  }
}
