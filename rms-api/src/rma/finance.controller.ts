import {
  Controller, Get, Query, Req, UseGuards, Inject,
} from '@nestjs/common';
import { RmsAuthGuard } from '../auth/rms-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RmaRepository } from './rma.repository.js';
import type { RmsUserContext } from '../users/users.service.js';

@Controller('finance')
@UseGuards(RmsAuthGuard, RolesGuard)
@Roles('FINANCE')
export class FinanceController {
  constructor(
    @Inject(RmaRepository) private readonly rmaRepository: RmaRepository,
  ) {}

  // WKFL-04: Finance views credit lines awaiting approval
  // GET /finance/credit-approvals?take=100&skip=0
  @Get('credit-approvals')
  async getCreditApprovals(
    @Query('take') take: string | undefined,
    @Query('skip') skip: string | undefined,
    @Req() req: Request & { rmsUser: RmsUserContext },
  ) {
    return this.rmaRepository.findCreditApprovalLines(req.rmsUser, {
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }
}
