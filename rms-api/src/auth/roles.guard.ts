import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator.js';
import type { RmsUserContext } from '../users/users.service.js';

// Applied per-controller or per-route via @UseGuards(RolesGuard) + @Roles('ADMIN').
// If no @Roles() decorator is present, any authenticated user passes.
// Requires RmsAuthGuard to have already attached req.rmsUser.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator = any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ rmsUser: RmsUserContext }>();
    const { rmsUser } = request;

    // Admin can access any role-restricted endpoint
    if (rmsUser.isAdmin) return true;

    return requiredRoles.includes(rmsUser.role);
  }
}
