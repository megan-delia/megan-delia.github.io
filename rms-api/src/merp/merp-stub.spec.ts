/**
 * Integration tests for MerpStubAdapter — FOUND-05
 *
 * Tests against the real test database to confirm actual DB row creation.
 * Verifies typed return contract AND MerpIntegrationLog rows.
 *
 * ROADMAP criterion: "MERP adapter interface compiles with typed contracts;
 *                     stub returns structured mock → MerpResult{status:'STUB'}"
 *
 * Prerequisites:
 *   docker compose up -d (postgres container running)
 *   DATABASE_URL env var pointing to rms_dev database
 *   npx prisma migrate deploy (migrations applied)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MerpModule } from './merp.module.js';
import { MerpAdapter } from './merp-adapter.interface.js';
import type { CreditMemoPayload, ReplacementOrderPayload } from './merp.types.js';

describe('MerpStubAdapter — FOUND-05: Typed MERP contracts and DB logging', () => {
  let prisma: PrismaService;
  let merpAdapter: MerpAdapter;

  // Fixed test RMA IDs for log row lookup
  const creditMemoRmaId = `test-rma-cm-${Date.now()}`;
  const replacementOrderRmaId = `test-rma-ro-${Date.now()}`;

  const creditMemoPayload: CreditMemoPayload = {
    rmaId: creditMemoRmaId,
    rmaNumber: 'RMA-TEST-001',
    customerAccountNumber: 'CUST-001',
    lines: [
      {
        lineNumber: 1,
        partNumber: 'PART-ABC-123',
        quantityApproved: 2,
        unitCost: 9999,
        creditReason: 'Defective',
      },
    ],
    requestedBy: 'test-agent-id',
  };

  const replacementOrderPayload: ReplacementOrderPayload = {
    rmaId: replacementOrderRmaId,
    rmaNumber: 'RMA-TEST-002',
    customerAccountNumber: 'CUST-001',
    shipToAddress: {
      line1: '123 Test St',
      city: 'Testville',
      state: 'TX',
      zip: '75001',
      country: 'US',
    },
    lines: [
      {
        lineNumber: 1,
        partNumber: 'PART-ABC-123',
        quantityApproved: 2,
        unitCost: 9999,
      },
    ],
    requestedBy: 'test-agent-id',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        MerpModule,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    merpAdapter = moduleRef.get(MerpAdapter);
  });

  afterAll(async () => {
    // Clean up MerpIntegrationLog rows created by these tests
    await prisma.merpIntegrationLog.deleteMany({
      where: {
        rmaId: { in: [creditMemoRmaId, replacementOrderRmaId] },
      },
    });
  });

  it('FOUND-05: createCreditMemo returns MerpResult{status:"STUB"}', async () => {
    const result = await merpAdapter.createCreditMemo(creditMemoPayload);

    expect(result.success).toBe(true);
    expect(result.status).toBe('STUB');
    expect(typeof result.referenceId).toBe('string');
    expect(result.referenceId).toMatch(/^STUB-CM-/);
  });

  it('FOUND-05: createCreditMemo creates MerpIntegrationLog row in DB', async () => {
    // Note: createCreditMemo was already called in previous test; log row was created then.
    // We rely on test order here — Jest runs within-describe sequentially.
    const log = await prisma.merpIntegrationLog.findFirst({
      where: { rmaId: creditMemoRmaId },
    });

    expect(log).not.toBeNull();
    expect(log!.operationType).toBe('CREDIT_MEMO');
    expect(log!.status).toBe('STUB');
  });

  it('FOUND-05: createReplacementOrder returns MerpResult{status:"STUB"}', async () => {
    const result = await merpAdapter.createReplacementOrder(replacementOrderPayload);

    expect(result.success).toBe(true);
    expect(result.status).toBe('STUB');
    expect(typeof result.referenceId).toBe('string');
    expect(result.referenceId).toMatch(/^STUB-RO-/);
  });

  it('FOUND-05: createReplacementOrder creates MerpIntegrationLog row in DB', async () => {
    const log = await prisma.merpIntegrationLog.findFirst({
      where: { rmaId: replacementOrderRmaId },
    });

    expect(log).not.toBeNull();
    expect(log!.operationType).toBe('REPLACEMENT_ORDER');
    expect(log!.status).toBe('STUB');
  });
});
