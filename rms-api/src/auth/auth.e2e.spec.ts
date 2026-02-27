/**
 * E2E tests for the guard chain — FOUND-01 and FOUND-02
 *
 * Tests the full two-step guard chain (JwtAuthGuard + RmsAuthGuard) against
 * a real NestJS testing module connected to the test DB.
 *
 * ROADMAP criteria verified:
 * - FOUND-01: A Returns Agent authenticates via portal JWT without second login
 * - FOUND-02: Customer role cannot access Returns Agent endpoint → 403
 *
 * Prerequisites:
 *   docker compose up -d (postgres container running)
 *   DATABASE_URL env var pointing to rms_dev database
 *   npx prisma migrate deploy (migrations applied)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthModule } from './auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RmsAuthGuard } from './rms-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { Roles } from './roles.decorator.js';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { RmsUserContext } from '../users/users.service.js';

// Minimal TestController defined inline — not added to production src/
@Controller()
class TestController {
  @Get('test-auth')
  @UseGuards(JwtAuthGuard, RmsAuthGuard)
  testAuth(@Req() req: Request & { rmsUser: RmsUserContext }) {
    return { rmsUserId: req.rmsUser.id };
  }

  @Get('test-agent-only')
  @UseGuards(JwtAuthGuard, RmsAuthGuard, RolesGuard)
  @Roles('RETURNS_AGENT')
  testAgentOnly() {
    return { ok: true };
  }
}

describe('Auth guard chain — FOUND-01 & FOUND-02', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // Test data IDs — cleaned up in afterAll
  let branchId: string;
  let agentUserId: string;
  let customerUserId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        UsersModule,
        AuthModule,
      ],
      controllers: [TestController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Seed test data
    const branch = await prisma.branch.create({
      data: { name: 'Test Branch A', code: `TEST-A-${Date.now()}` },
    });
    branchId = branch.id;

    const agentUser = await prisma.user.create({
      data: {
        portalUserId: `portal-agent-${Date.now()}`,
        email: `agent-${Date.now()}@test.example`,
        displayName: 'Test Agent',
        branchRoles: {
          create: { branchId, role: 'RETURNS_AGENT', assignedBy: 'test-setup' },
        },
      },
    });
    agentUserId = agentUser.id;

    const customerUser = await prisma.user.create({
      data: {
        portalUserId: `portal-customer-${Date.now()}`,
        email: `customer-${Date.now()}@test.example`,
        displayName: 'Test Customer',
        branchRoles: {
          create: { branchId, role: 'CUSTOMER', assignedBy: 'test-setup' },
        },
      },
    });
    customerUserId = customerUser.id;
  });

  afterAll(async () => {
    // Clean up test data in reverse FK order
    if (agentUserId) {
      await prisma.userBranchRole.deleteMany({ where: { userId: agentUserId } });
      await prisma.user.delete({ where: { id: agentUserId } });
    }
    if (customerUserId) {
      await prisma.userBranchRole.deleteMany({ where: { userId: customerUserId } });
      await prisma.user.delete({ where: { id: customerUserId } });
    }
    if (branchId) {
      await prisma.branch.delete({ where: { id: branchId } });
    }
    await app.close();
  });

  it('FOUND-01: valid JWT for provisioned Returns Agent returns 200', async () => {
    const agent = await prisma.user.findUnique({ where: { id: agentUserId } });
    const token = jwtService.sign({ sub: agent!.portalUserId, email: agent!.email });

    const res = await request(app.getHttpServer())
      .get('/test-auth')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.rmsUserId).toBe(agentUserId);
  });

  it('FOUND-01 (negative): valid JWT for unprovisioned user returns 403', async () => {
    // portalUserId that has no user_branch_roles row
    const token = jwtService.sign({
      sub: `unprovisioned-${Date.now()}`,
      email: 'ghost@test.example',
    });

    const res = await request(app.getHttpServer())
      .get('/test-auth')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('not provisioned');
  });

  it('FOUND-01 (negative): no JWT returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/test-auth');

    expect(res.status).toBe(401);
  });

  it('FOUND-02: Customer role cannot access Returns Agent endpoint → 403', async () => {
    const customer = await prisma.user.findUnique({ where: { id: customerUserId } });
    const token = jwtService.sign({ sub: customer!.portalUserId, email: customer!.email });

    const res = await request(app.getHttpServer())
      .get('/test-agent-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('FOUND-02: Returns Agent can access Returns Agent endpoint → 200', async () => {
    const agent = await prisma.user.findUnique({ where: { id: agentUserId } });
    const token = jwtService.sign({ sub: agent!.portalUserId, email: agent!.email });

    const res = await request(app.getHttpServer())
      .get('/test-agent-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
