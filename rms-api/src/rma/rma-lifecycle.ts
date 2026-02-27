import { RmaStatus } from '../../generated/prisma/enums.js';
import { BadRequestException } from '@nestjs/common';

// Single authoritative source of truth for all valid RMA state transitions.
// If a (from, to) pair is NOT in this map, the transition is forbidden.
// Terminal states (REJECTED, CANCELLED, CLOSED) have empty arrays — no outgoing transitions.
//
// Design: Readonly<Record<RmaStatus, readonly RmaStatus[]>> means TypeScript
// enforces that ALL RmaStatus values are present as keys (no missing states).
export const ALLOWED_TRANSITIONS: Readonly<Record<RmaStatus, readonly RmaStatus[]>> = {
  [RmaStatus.DRAFT]:         [RmaStatus.SUBMITTED, RmaStatus.CANCELLED],
  [RmaStatus.SUBMITTED]:     [RmaStatus.APPROVED, RmaStatus.REJECTED, RmaStatus.INFO_REQUIRED, RmaStatus.CANCELLED],
  [RmaStatus.INFO_REQUIRED]: [RmaStatus.SUBMITTED, RmaStatus.CANCELLED],
  [RmaStatus.APPROVED]:      [RmaStatus.RECEIVED, RmaStatus.CANCELLED],
  [RmaStatus.RECEIVED]:      [RmaStatus.QC_COMPLETE],
  [RmaStatus.QC_COMPLETE]:   [RmaStatus.RESOLVED],
  [RmaStatus.RESOLVED]:      [RmaStatus.CLOSED],
  [RmaStatus.REJECTED]:      [],   // terminal — no further transitions
  [RmaStatus.CANCELLED]:     [],   // terminal — no further transitions
  [RmaStatus.CLOSED]:        [],   // terminal — no further transitions
  [RmaStatus.CONTESTED]:     [RmaStatus.APPROVED, RmaStatus.CLOSED],  // overturn | uphold
} as const;

/**
 * Validates that transitioning from `from` to `to` is permitted.
 *
 * Throws BadRequestException with a structured body (InvalidTransitionError)
 * if the transition is not allowed. The allowedTransitions array in the error
 * body tells API callers which transitions ARE valid from the current state.
 *
 * Called at the top of every RmaService lifecycle method — before any DB write.
 */
export function assertValidTransition(from: RmaStatus, to: RmaStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new BadRequestException({
      error: 'INVALID_TRANSITION',
      message: `Cannot transition RMA from ${from} to ${to}`,
      fromStatus: from,
      toStatus: to,
      allowedTransitions: [...allowed],
    });
  }
}
