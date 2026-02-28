import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Req,
  UseGuards, Inject,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { RmsAuthGuard } from '../auth/rms-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RmaService } from './rma.service.js';
import { RmaRepository } from './rma.repository.js';
import type { RmsUserContext } from '../users/users.service.js';

// ---- Zod body schemas ----

const CreateRmaBodySchema = z.object({
  branchId: z.string().min(1),
  customerId: z.string().optional(),
  lines: z.array(z.object({
    partNumber: z.string().min(1),
    orderedQty: z.number().int().positive(),
    reasonCode: z.string().min(1),
    disposition: z.enum(['CREDIT', 'REPLACEMENT', 'SCRAP', 'RTV']).optional(),
  })).min(1, 'At least one line is required'),
});

const CancelBodySchema = z.object({
  cancellationReason: z.string().min(1, 'Cancellation reason is required'),
});

const InfoRequiredBodySchema = z.object({
  infoRequestNote: z.string().optional(),
});

const ReceiveBodySchema = z.object({
  receivedQty: z.number().int().min(0),
});

const AddLineBodySchema = z.object({
  partNumber: z.string().min(1),
  orderedQty: z.number().int().positive(),
  reasonCode: z.string().min(1),
  disposition: z.enum(['CREDIT', 'REPLACEMENT', 'SCRAP', 'RTV']).optional(),
});

const UpdateLineBodySchema = z.object({
  partNumber: z.string().optional(),
  orderedQty: z.number().int().positive().optional(),
  reasonCode: z.string().optional(),
  disposition: z.enum(['CREDIT', 'REPLACEMENT', 'SCRAP', 'RTV']).nullable().optional(),
});

// ---- Controller ----

@Controller('rmas')
@UseGuards(RmsAuthGuard, RolesGuard)
export class LifecycleController {
  constructor(
    @Inject(RmaService) private readonly rmaService: RmaService,
    @Inject(RmaRepository) private readonly rmaRepository: RmaRepository,
  ) {}

  // LCYC-01: Returns Agent creates a new Draft RMA
  @Post()
  @Roles('RETURNS_AGENT')
  async createDraft(
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = CreateRmaBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.createDraft(result.data, req.rmsUser);
  }

  // GET /rmas — branch-scoped list (FOUND-03)
  @Get()
  @Roles('RETURNS_AGENT', 'BRANCH_MANAGER', 'ADMIN', 'FINANCE', 'QC', 'WAREHOUSE')
  async listRmas(
    @Query('status') status: string | undefined,
    @Query('take') take: string | undefined,
    @Query('skip') skip: string | undefined,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaRepository.findManyBranchScoped(req.rmsUser, {
      status: status as any,
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  // GET /rmas/:id — branch-scoped single (FOUND-03)
  @Get(':id')
  @Roles('RETURNS_AGENT', 'BRANCH_MANAGER', 'ADMIN', 'FINANCE', 'QC', 'WAREHOUSE')
  async getRma(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const rma = await this.rmaRepository.findByIdBranchScoped(id, req.rmsUser);
    if (!rma) throw new NotFoundException(`RMA ${id} not found`);
    return rma;
  }

  // LCYC-02: Returns Agent or Customer submits a Draft RMA
  @Post(':id/submit')
  @Roles('RETURNS_AGENT', 'CUSTOMER')
  async submit(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.submit(id, req.rmsUser);
  }

  // LCYC-11: Returns Agent or Admin cancels with required reason
  @Post(':id/cancel')
  @Roles('RETURNS_AGENT', 'ADMIN')
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = CancelBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.cancel(id, result.data, req.rmsUser);
  }

  // LCYC-05: Returns Agent places RMA in Info Required
  @Post(':id/info-required')
  @Roles('RETURNS_AGENT')
  async placeInfoRequired(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = InfoRequiredBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.placeInfoRequired(id, result.data, req.rmsUser);
  }

  // LCYC-06: Returns Agent or Customer resubmits from Info Required
  @Post(':id/resubmit')
  @Roles('RETURNS_AGENT', 'CUSTOMER')
  async resubmit(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.resubmit(id, req.rmsUser);
  }

  // LCYC-08: QC staff triggers RECEIVED → QC_COMPLETE transition
  @Post(':id/complete-qc')
  @Roles('QC')
  async completeQc(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.completeQc(id, req.rmsUser);
  }

  // LCYC-09 + WKFL-04: Returns Agent or Finance resolves (Finance gate in service)
  @Post(':id/resolve')
  @Roles('RETURNS_AGENT', 'FINANCE')
  async resolve(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.resolve(id, req.rmsUser);
  }

  // LCYC-10: Returns Agent or Admin closes a Resolved RMA
  @Post(':id/close')
  @Roles('RETURNS_AGENT', 'ADMIN')
  async close(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.close(id, req.rmsUser);
  }

  // LCYC-07 + LINE-03: Warehouse records receipt per line
  @Post(':id/lines/:lineId/receive')
  @Roles('WAREHOUSE')
  async recordReceipt(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = ReceiveBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.recordReceipt(id, lineId, result.data, req.rmsUser);
  }

  // LINE-01: Returns Agent adds a line to a Draft/Info Required RMA
  @Post(':id/lines')
  @Roles('RETURNS_AGENT')
  async addLine(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = AddLineBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.addLine(id, result.data, req.rmsUser);
  }

  // LINE-01 + LINE-02: Returns Agent updates line fields including disposition
  @Patch(':id/lines/:lineId')
  @Roles('RETURNS_AGENT')
  async updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = UpdateLineBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.updateLine(id, lineId, result.data, req.rmsUser);
  }

  // LINE-01: Returns Agent removes a line from a Draft/Info Required RMA
  @Delete(':id/lines/:lineId')
  @Roles('RETURNS_AGENT')
  async removeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.removeLine(id, lineId, req.rmsUser);
  }
}
