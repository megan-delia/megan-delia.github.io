import { RmsRole, DispositionType } from '../../generated/prisma/enums.js';

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

// ----------------------------------------------------------------
// Phase 3 input contracts
// ----------------------------------------------------------------

export interface ContestInput {
  disputeReason: string;  // required; customer's dispute reason
}

export interface OverturnInput {
  resolutionNote: string;  // required; Branch Manager's documented note
}

export interface UpholdInput {
  resolutionNote: string;  // required; Branch Manager's documented note
}

export interface SplitLineInput {
  partNumber: string;
  orderedQty: number;        // positive integer; all splits must sum to original orderedQty
  reasonCode: string;
  disposition?: DispositionType;
}

// Phase 3 extended QC inspection input — adds structured QC result fields to Phase 2's RecordQcInput
export interface RecordQcInspectionInput {
  lineId: string;
  inspectedQty: number;
  qcPass?: boolean;           // true = pass, false = fail
  qcFindings?: string;        // free-text inspection notes
  qcDispositionRecommendation?: DispositionType;  // QC staff recommendation
}

export interface ApproveLineCreditInput {
  // No extra fields needed — the actor context carries identity
}

// Approval queue response shape
export interface ApprovalQueueItem {
  id: string;
  rmaNumber: string;
  status: string;              // RmaStatus (SUBMITTED or CONTESTED)
  createdAt: Date;
  customerId: string;
  submittedByName: string | null;
  submittedByEmail: string | null;
  lineCount: number;
  totalOrderedQty: number;
}

// Finance credit queue response shape
export interface CreditApprovalQueueItem {
  rmaId: string;
  rmaNumber: string;
  lineId: string;
  partNumber: string;
  orderedQty: number;
  disposition: string;         // always 'CREDIT'
  rmaStatus: string;           // always 'QC_COMPLETE'
}
