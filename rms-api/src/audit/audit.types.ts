// AuditAction constants — stored as strings in DB for forward-compatibility.
// Add new actions here as new lifecycle events are implemented in later phases.
// Do NOT use a Prisma enum for this — strings allow expansion without migrations.
export const AuditAction = {
  // RMA lifecycle
  RMA_CREATED: 'RMA_CREATED',
  RMA_SUBMITTED: 'RMA_SUBMITTED',
  RMA_APPROVED: 'RMA_APPROVED',
  RMA_REJECTED: 'RMA_REJECTED',
  RMA_INFO_REQUIRED: 'RMA_INFO_REQUIRED',
  RMA_CONTESTED: 'RMA_CONTESTED',
  RMA_CANCELLED: 'RMA_CANCELLED',
  RMA_RECEIVED: 'RMA_RECEIVED',
  RMA_RESOLVED: 'RMA_RESOLVED',
  RMA_CLOSED: 'RMA_CLOSED',
  STATUS_CHANGED: 'STATUS_CHANGED',

  // Line item operations
  LINE_ADDED: 'LINE_ADDED',
  LINE_UPDATED: 'LINE_UPDATED',
  LINE_SPLIT: 'LINE_SPLIT',
  DISPOSITION_SET: 'DISPOSITION_SET',

  // Communication and attachments
  COMMENT_ADDED: 'COMMENT_ADDED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',

  // MERP integration events
  MERP_CREDIT_TRIGGERED: 'MERP_CREDIT_TRIGGERED',
  MERP_REPLACEMENT_TRIGGERED: 'MERP_REPLACEMENT_TRIGGERED',

  // User provisioning (admin actions)
  USER_PROVISIONED: 'USER_PROVISIONED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  ASSIGNMENT_CHANGED: 'ASSIGNMENT_CHANGED',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

// Input type for AuditService.logEvent() — all fields match AuditEvent model
export interface AuditEventInput {
  rmaId?: string;
  rmaLineId?: string;
  actorId: string;
  actorRole: string;
  action: AuditAction;
  fromStatus?: string;
  toStatus?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}
