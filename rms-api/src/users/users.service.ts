import { Injectable } from '@nestjs/common';
import { RmsRole } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';

// The resolved user context attached to req.rmsUser after the two-step guard chain.
// Every controller that needs auth context reads from req.rmsUser.
export interface RmsUserContext {
  id: string;
  portalUserId: string;
  email: string;
  role: RmsRole;         // highest-priority role across all branch assignments
  branchIds: string[];   // all branches this user is assigned to
  isAdmin: boolean;
}

// Role priority for resolving the "primary" role when a user has multiple.
// Higher index = higher priority.
const ROLE_PRIORITY: RmsRole[] = [
  RmsRole.CUSTOMER,
  RmsRole.WAREHOUSE,
  RmsRole.QC,
  RmsRole.FINANCE,
  RmsRole.RETURNS_AGENT,
  RmsRole.BRANCH_MANAGER,
  RmsRole.ADMIN,
];

function resolvePrimaryRole(roles: RmsRole[]): RmsRole {
  // Return the highest-priority role the user holds across all branches
  return roles.reduce((highest, current) => {
    return ROLE_PRIORITY.indexOf(current) > ROLE_PRIORITY.indexOf(highest)
      ? current
      : highest;
  }, roles[0]);
}

// Query-layer ownership filter.
// Returns {} for Admin (global visibility — no branch filter).
// Returns Prisma WHERE fragment for all other roles.
// USAGE: prisma.rma.findMany({ where: { ...branchScopeWhere(user) } })
export function branchScopeWhere(
  user: RmsUserContext,
): Record<string, unknown> {
  if (user.isAdmin) return {};
  return { branchId: { in: user.branchIds } };
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  // Returns null when user has a valid portal JWT but has NOT been provisioned in RMS.
  // RmsAuthGuard converts null → ForbiddenException(403). Does NOT throw here.
  async findByPortalId(portalUserId: string): Promise<RmsUserContext | null> {
    const user = await this.usersRepository.findByPortalUserId(portalUserId);

    // No user record OR no branch role assignments → not provisioned
    if (!user || user.branchRoles.length === 0) return null;

    const roles = user.branchRoles.map((br) => br.role);
    const primaryRole = resolvePrimaryRole(roles);

    return {
      id: user.id,
      portalUserId: user.portalUserId,
      email: user.email,
      role: primaryRole,
      branchIds: user.branchRoles.map((br) => br.branchId),
      isAdmin: primaryRole === RmsRole.ADMIN,
    };
  }
}
