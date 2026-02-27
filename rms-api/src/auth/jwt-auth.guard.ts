import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Step 1 of the two-step guard chain.
// Validates the portal JWT signature and expiry.
// Attaches { portalUserId, email } to req.user on success.
// Returns 401 on invalid or expired token.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
