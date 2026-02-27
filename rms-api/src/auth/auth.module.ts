import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RmsAuthGuard } from './rms-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('PORTAL_JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
      inject: [ConfigService],
    }),
    UsersModule,
  ],
  providers: [JwtStrategy, JwtAuthGuard, RmsAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RmsAuthGuard, RolesGuard, PassportModule],
})
export class AuthModule {}
