import {
  Controller, Post, Param, Body, Req, UseGuards, Inject,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { RmsAuthGuard } from '../auth/rms-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RmaService } from './rma.service.js';
import type { RmsUserContext } from '../users/users.service.js';

// Zod schemas for request bodies
const ContestBodySchema = z.object({
  disputeReason: z.string().min(1, 'Dispute reason is required'),
});

const ResolutionNoteBodySchema = z.object({
  resolutionNote: z.string().min(1, 'Resolution note is required'),
});

const SplitLineBodySchema = z.object({
  splits: z.array(z.object({
    partNumber: z.string().min(1),
    orderedQty: z.number().int().positive(),
    reasonCode: z.string().min(1),
    disposition: z.enum(['CREDIT', 'REPLACEMENT', 'SCRAP', 'RTV']).optional(),
  })).min(2, 'Split must produce at least 2 lines'),
});

const QcInspectionBodySchema = z.object({
  inspectedQty: z.number().int().min(0),
  qcPass: z.boolean().optional(),
  qcFindings: z.string().optional(),
  qcDispositionRecommendation: z.enum(['CREDIT', 'REPLACEMENT', 'SCRAP', 'RTV']).optional(),
});

@Controller('rmas')
@UseGuards(RmsAuthGuard, RolesGuard)
export class RmaController {
  constructor(@Inject(RmaService) private readonly rmaService: RmaService) {}

  // WKFL-02: Customer contests a REJECTED RMA
  @Post(':id/contest')
  @Roles('CUSTOMER')
  async contest(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = ContestBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.contest(id, result.data, req.rmsUser);
  }

  // WKFL-03: Branch Manager overturns CONTESTED → APPROVED
  @Post(':id/overturn')
  @Roles('BRANCH_MANAGER')
  async overturn(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = ResolutionNoteBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.overturn(id, result.data, req.rmsUser);
  }

  // WKFL-03: Branch Manager upholds CONTESTED → CLOSED
  @Post(':id/uphold')
  @Roles('BRANCH_MANAGER')
  async uphold(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = ResolutionNoteBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.uphold(id, result.data, req.rmsUser);
  }

  // LINE-04: Returns Agent splits a line
  @Post(':id/lines/:lineId/split')
  @Roles('RETURNS_AGENT')
  async splitLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = SplitLineBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.splitLine(id, lineId, result.data.splits, req.rmsUser);
  }

  // WKFL-05: QC staff records per-line inspection results
  @Post(':id/lines/:lineId/qc-inspection')
  @Roles('QC')
  async recordQcInspection(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = QcInspectionBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.recordQcInspection(id, lineId, {
      lineId,
      inspectedQty: result.data.inspectedQty,
      qcPass: result.data.qcPass,
      qcFindings: result.data.qcFindings,
      qcDispositionRecommendation: result.data.qcDispositionRecommendation as any,
    }, req.rmsUser);
  }

  // WKFL-04: Finance approves a CREDIT line
  @Post(':id/lines/:lineId/approve-credit')
  @Roles('FINANCE')
  async approveLineCredit(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.approveLineCredit(id, lineId, req.rmsUser);
  }
}
