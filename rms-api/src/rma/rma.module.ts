import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RmaService } from './rma.service.js';
import { RmaRepository } from './rma.repository.js';
import { RmaController } from './rma.controller.js';
import { WorkflowController } from './workflow.controller.js';
import { FinanceController } from './finance.controller.js';
import { LifecycleController } from './lifecycle.controller.js';

@Module({
  imports: [AuditModule],       // AuditModule is NOT global — must explicitly import
  controllers: [RmaController, WorkflowController, FinanceController, LifecycleController],
  providers: [RmaService, RmaRepository],
  exports: [RmaService],
})
export class RmaModule {}
