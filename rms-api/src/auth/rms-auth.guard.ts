import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';

// Step 2 of the two-step guard chain.
// Requires JwtAuthGuard to have already attached req.user (portalUserId).
// Looks up the user in user_branch_roles by portalUserId.
// Returns 403 (not 500) if user has no RMS role assignment — Pitfall 1.
// Attaches RmsUserContext to req.rmsUser on success.
@Injectable()
export class RmsAuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: { portalUserId: string; email: string };
      rmsUser?: import('../users/users.service.js').RmsUserContext;
    }>();

    const { portalUserId } = request.user;
    const rmsUser = await this.usersService.findByPortalId(portalUserId);

    if (!rmsUser) {
      // CRITICAL: throw ForbiddenException, not let it crash as 500 — Pitfall 1
      throw new ForbiddenException('User not provisioned in RMS — contact your administrator');
    }

    request.rmsUser = rmsUser;
    return true;
  }
}
