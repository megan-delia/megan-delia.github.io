import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface PortalJwtPayload {
  sub: string;   // portal user ID — becomes portalUserId
  email: string;
  iat?: number;
  exp?: number;
}

export interface PortalUserIdentity {
  portalUserId: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('PORTAL_JWT_SECRET'),
    });
  }

  // Called after signature verification. Return value is attached to req.user.
  // Does NOT look up RMS roles — that is RmsAuthGuard's job.
  async validate(payload: PortalJwtPayload): Promise<PortalUserIdentity> {
    return { portalUserId: payload.sub, email: payload.email };
  }
}
