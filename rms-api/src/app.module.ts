import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { AuditModule } from './audit/audit.module.js';
import { MerpModule } from './merp/merp.module.js';
import { RmaModule } from './rma/rma.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { validate } from './config/config.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    AuditModule,
    MerpModule,
    RmaModule,
  ],
  providers: [
    // Apply JwtAuthGuard globally — every endpoint is JWT-protected by default.
    // Routes that should be public (health check) use @Public() decorator (add in later phase if needed).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
