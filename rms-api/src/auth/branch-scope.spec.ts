/**
 * Unit tests for branchScopeWhere() — FOUND-03
 *
 * Pure unit tests — no DB, no NestJS bootstrap, no network.
 * These prove the ownership filter is correct before any HTTP layer is involved.
 *
 * ROADMAP criterion: "Branch A user cannot retrieve Branch B RMA"
 * branchScopeWhere() generates the Prisma WHERE fragment that enforces this.
 */

// Mock prisma-dependent modules so this pure function test doesn't require a DB
jest.mock('../prisma/prisma.service.js', () => ({}));
jest.mock('../users/users.repository.js', () => ({ UsersRepository: jest.fn() }));

import { branchScopeWhere, RmsUserContext } from '../users/users.service.js';
import { RmsRole } from '../../generated/prisma/enums.js';

describe('branchScopeWhere — FOUND-03: Branch data isolation', () => {
  it('Admin user gets empty WHERE clause (global visibility)', () => {
    const adminUser: RmsUserContext = {
      id: 'user-admin-1',
      portalUserId: 'portal-admin-1',
      email: 'admin@example.com',
      role: RmsRole.ADMIN,
      branchIds: ['b1', 'b2'],
      isAdmin: true,
    };

    const result = branchScopeWhere(adminUser);

    expect(result).toEqual({});
  });

  it('Returns Agent gets single-branch filter', () => {
    const agentUser: RmsUserContext = {
      id: 'user-agent-1',
      portalUserId: 'portal-agent-1',
      email: 'agent@example.com',
      role: RmsRole.RETURNS_AGENT,
      branchIds: ['branch-a'],
      isAdmin: false,
    };

    const result = branchScopeWhere(agentUser);

    expect(result).toEqual({ branchId: { in: ['branch-a'] } });
  });

  it('Branch Manager with multiple branches gets multi-branch filter', () => {
    const managerUser: RmsUserContext = {
      id: 'user-manager-1',
      portalUserId: 'portal-manager-1',
      email: 'manager@example.com',
      role: RmsRole.BRANCH_MANAGER,
      branchIds: ['branch-a', 'branch-b'],
      isAdmin: false,
    };

    const result = branchScopeWhere(managerUser);

    expect(result).toEqual({ branchId: { in: ['branch-a', 'branch-b'] } });
  });
});
