// WARNING: These payload shapes are based on standard electronics distribution
// domain knowledge. They MUST be validated against the actual MERP API spec
// before v2 live integration. The stub uses these shapes today; the live adapter
// must match them exactly (or types must be updated before v2 work begins).

export interface CreditMemoPayload {
  rmaId: string;           // RMS RMA ID — for idempotency checking
  rmaNumber: string;       // human-readable RMA number
  customerAccountNumber: string;
  lines: Array<{
    lineNumber: number;
    partNumber: string;
    quantityApproved: number;
    unitCost: number;      // in cents or as decimal — confirm with MERP team
    creditReason: string;
  }>;
  requestedBy: string;     // RMS user ID of the agent triggering the credit
}

export interface ReplacementOrderPayload {
  rmaId: string;
  rmaNumber: string;
  customerAccountNumber: string;
  shipToAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  lines: Array<{
    lineNumber: number;
    partNumber: string;
    quantityApproved: number;
    unitCost: number;
  }>;
  requestedBy: string;
}

export interface MerpResult {
  success: boolean;
  referenceId: string | null;   // MERP-assigned ID (null on failure or stub)
  status: 'CREATED' | 'STUB' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
}
