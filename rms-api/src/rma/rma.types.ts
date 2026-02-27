import { RmsRole } from '../../generated/prisma/enums.js';

// ----------------------------------------------------------------
// Actor context — passed to every service method.
// Comes from req.rmsUser (RmsAuthGuard output) in Phase 3.
// Redeclared here to avoid circular import from users.service.ts.
// ----------------------------------------------------------------
export interface RmaActorContext {
  id: string;           // RMS User.id (UUID)
  portalUserId: string;
  email: string;
  role: RmsRole;
  branchIds: string[];
  isAdmin: boolean;
}

// ----------------------------------------------------------------
// Line item inputs
// ----------------------------------------------------------------

// DispositionType matches the Prisma enum — re-exported for service consumers
export { DispositionType } from '../../generated/prisma/enums.js';

export interface LineInput {
  partNumber: string;       // non-empty string, e.g. "P-12345"
  orderedQty: number;       // positive integer
  reasonCode: string;       // structured code, e.g. "DEFECTIVE", "WRONG_ITEM"
  disposition?: string;     // DispositionType | undefined — optional at creation
}

export interface UpdateLineInput {
  partNumber?: string;
  orderedQty?: number;
  reasonCode?: string;
  disposition?: string | null;  // null explicitly clears disposition
}

export interface RecordReceiptInput {
  receivedQty: number;   // non-negative integer; over-receipt is allowed
}

export interface RecordQcInput {
  inspectedQty: number;  // must be <= receivedQty; service enforces
  qcNotes?: string;      // optional inspector notes; stored in audit newValue
}

// ----------------------------------------------------------------
// RMA creation input
// ----------------------------------------------------------------

export interface CreateRmaInput {
  branchId: string;
  customerId?: string;    // nullable; internal RMAs may not have a customer
  lines: LineInput[];     // at least one line required at creation
}

// ----------------------------------------------------------------
// Transition inputs for methods that require a reason string
// ----------------------------------------------------------------

export interface RejectRmaInput {
  rejectionReason: string;  // non-empty; required by LCYC-04
}

export interface CancelRmaInput {
  cancellationReason: string;  // non-empty; required by LCYC-11
}

export interface PlaceInfoRequiredInput {
  infoRequestNote?: string;  // optional context for the submitter; stored in audit
}

// ----------------------------------------------------------------
// Invalid transition error shape (Claude's discretion)
// ----------------------------------------------------------------

// Thrown as BadRequestException with this body — consumers can inspect allowedTransitions
export interface InvalidTransitionError {
  error: 'INVALID_TRANSITION';
  message: string;
  fromStatus: string;
  toStatus: string;
  allowedTransitions: string[];
}
