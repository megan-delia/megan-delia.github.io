import {
  Controller, Get, Post, Param, Body, Query, Req, UseGuards, Inject,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { RmsAuthGuard } from '../auth/rms-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RmaService } from './rma.service.js';
import { RmaRepository } from './rma.repository.js';
import type { RmsUserContext } from '../users/users.service.js';

const RejectBodySchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required'),
});

@Controller('approvals')
@UseGuards(RmsAuthGuard, RolesGuard)
@Roles('BRANCH_MANAGER')
export class WorkflowController {
  constructor(
    @Inject(RmaService) private readonly rmaService: RmaService,
    @Inject(RmaRepository) private readonly rmaRepository: RmaRepository,
  ) {}

  // WKFL-01: Branch Manager views approvals queue (SUBMITTED + CONTESTED RMAs)
  // GET /approvals/queue?branchId=xxx&status=SUBMITTED&take=50&skip=0
  @Get('queue')
  async getApprovalQueue(
    @Query('branchId') branchId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('take') take: string | undefined,
    @Query('skip') skip: string | undefined,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaRepository.findForApprovalQueue(req.rmsUser, {
      branchId,
      status: status as any,   // RmaStatus — validated inside repository
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  // WKFL-01: Branch Manager approves from queue
  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaService.approve(id, req.rmsUser);
  }

  // WKFL-01: Branch Manager rejects from queue
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    const result = RejectBodySchema.safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.rmaService.reject(id, result.data, req.rmsUser);
  }
}
