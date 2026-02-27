import { Module } from '@nestjs/common';
import { RmaService } from './rma.service.js';
import { RmaRepository } from './rma.repository.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],       // AuditModule is NOT global — must explicitly import
  providers: [RmaService, RmaRepository],
  exports: [RmaService],        // Phase 3 controllers will inject RmaService
})
export class RmaModule {}
