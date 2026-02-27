import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RmsRole } from '../../generated/prisma/client.js';

export interface UserWithBranchRoles {
  id: string;
  portalUserId: string;
  email: string;
  displayName: string;
  branchRoles: Array<{
    branchId: string;
    role: RmsRole;
  }>;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByPortalUserId(portalUserId: string): Promise<UserWithBranchRoles | null> {
    return this.prisma.user.findUnique({
      where: { portalUserId },
      select: {
        id: true,
        portalUserId: true,
        email: true,
        displayName: true,
        branchRoles: {
          select: { branchId: true, role: true },
        },
      },
    });
  }
}
