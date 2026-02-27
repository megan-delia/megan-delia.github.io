import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MerpAdapter } from './merp-adapter.interface.js';
import { MerpStubAdapter } from './merp-stub.adapter.js';

@Module({
  imports: [PrismaModule],
  providers: [
    // Inject MerpAdapter token → resolves to MerpStubAdapter in v1.
    // To upgrade to live integration at v2: change useClass to MerpLiveAdapter.
    // Zero changes needed in any service that injects MerpAdapter.
    { provide: MerpAdapter, useClass: MerpStubAdapter },
  ],
  exports: [MerpAdapter],
})
export class MerpModule {}
