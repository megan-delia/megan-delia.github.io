# Architecture Research

**Domain:** Returns Management System (RMA Portal) — Electronics Distributor
**Researched:** 2026-02-27
**Confidence:** MEDIUM-HIGH (patterns from well-established ERP/workflow domain; specifics for MERP integration are LOW confidence since it is a custom system)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Host Portal (existing web app)                   │
│   Provides: session/auth token, navigation shell, user identity      │
├─────────────────────────────────────────────────────────────────────┤
│                        RMS React SPA (embedded module)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │  RMA List / │  │  RMA Detail │  │  Customer   │  │  Admin /  │  │
│  │  Dashboard  │  │  + Workflow │  │  Self-Serv. │  │  Config   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │
│         │                │                │               │         │
│  ┌──────┴────────────────┴────────────────┴───────────────┴──────┐  │
│  │          React Query / State Layer (TanStack Query)            │  │
│  └─────────────────────────────────┬──────────────────────────────┘  │
└────────────────────────────────────┼────────────────────────────────┘
                                     │ HTTP (REST)
┌────────────────────────────────────┼────────────────────────────────┐
│                        RMS Node.js API (Express)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Routes /   │  │   Service    │  │  Workflow /  │               │
│  │  Controllers │→ │    Layer     │→ │State Machine │               │
│  └──────────────┘  └──────┬───────┘  └──────┬───────┘               │
│                           │                 │                        │
│  ┌────────────────────────┼─────────────────┼──────────────────────┐│
│  │              Repository / Data Access Layer                      ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ ││
│  │  │  RMA     │  │ Audit    │  │ Attach-  │  │  MERP Adapter    │ ││
│  │  │  Repo    │  │ Log Repo │  │ ment Repo│  │  (REST stubs)    │ ││
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ ││
│  └───────┼─────────────┼─────────────┼─────────────────┼───────────┘│
└──────────┼─────────────┼─────────────┼─────────────────┼────────────┘
           │             │             │                 │
┌──────────┴─────────────┴─────────────┴──────────────┐  │
│              PostgreSQL Database                      │  │ REST calls
│  rmas │ rma_lines │ dispositions │ audit_logs        │  │
│  comments │ attachments │ users │ roles              │  │
└──────────────────────────────────────────────────────┘  │
                                               ┌───────────┴──────────┐
                                               │   MERP (Custom ERP)  │
                                               │   Credit Memo API    │
                                               │   Replacement Order  │
                                               └──────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Host Portal | Auth tokens, session context, nav shell, user identity injection | RMS React SPA (injects token/user via props or window context) |
| RMS React SPA | Rendering all RMA UI, routing within module, role-conditional display | RMS Node.js API (HTTP/REST) |
| React Query Layer | Server state caching, optimistic updates, background refresh, error handling | RMS Node.js API |
| Express Routes / Controllers | HTTP request validation, auth middleware, response shaping — no business logic | Service Layer |
| Service Layer | All business logic: workflow transitions, validation rules, orchestration | State Machine, Repository Layer, MERP Adapter |
| Workflow / State Machine | RMA lifecycle enforcement — valid transitions, guards, side effects on transition | Service Layer (invoked by it); owns state transition logic |
| Repository Layer | SQL queries, data access abstraction — services call repos, never raw DB | PostgreSQL |
| Audit Log Repository | Append-only write of every state/field change with actor + timestamp | PostgreSQL (audit_logs table) |
| Attachment Repository | File metadata storage; delegates to file store (local disk or object storage) | PostgreSQL + filesystem / object store |
| MERP Adapter | Encapsulates all MERP REST API calls; v1 ships as stubs returning shaped responses | MERP ERP REST API |
| PostgreSQL | Primary system of record for all RMA data | Repository Layer |

---

## Recommended Project Structure

```
/rms/
├── client/                         # React SPA
│   ├── src/
│   │   ├── features/               # Feature-sliced: one folder per domain slice
│   │   │   ├── rma/                # RMA list, detail, creation
│   │   │   │   ├── components/
│   │   │   │   ├── hooks/
│   │   │   │   ├── api.ts          # TanStack Query hooks for this feature
│   │   │   │   └── types.ts
│   │   │   ├── workflow/           # Status badge, transition buttons, history timeline
│   │   │   ├── attachments/
│   │   │   ├── comments/
│   │   │   ├── admin/              # Role/user management
│   │   │   └── dashboard/
│   │   ├── shared/                 # Cross-feature: UI kit, auth context, RBAC hooks
│   │   │   ├── auth/               # useCurrentUser(), useHasRole(), token forwarding
│   │   │   ├── rbac/               # Permission map, ProtectedRoute, canDo() helper
│   │   │   └── ui/                 # Button, Badge, Modal, DataTable primitives
│   │   ├── lib/                    # Axios client, error handling, date utils
│   │   └── App.tsx                 # Router root; reads auth from host portal
│   └── package.json
│
├── server/                         # Node.js API
│   ├── src/
│   │   ├── routes/                 # Express routers — one file per resource
│   │   │   ├── rmas.ts
│   │   │   ├── rma-lines.ts
│   │   │   ├── comments.ts
│   │   │   ├── attachments.ts
│   │   │   └── admin.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts             # Validate token from host portal; attach req.user
│   │   │   ├── rbac.ts             # requireRole() / requirePermission() middleware
│   │   │   └── errorHandler.ts
│   │   ├── services/               # Business logic — one file per domain aggregate
│   │   │   ├── rmaService.ts       # Create, update, transition, query RMAs
│   │   │   ├── lineService.ts      # Line-level operations and dispositions
│   │   │   ├── commentService.ts
│   │   │   ├── attachmentService.ts
│   │   │   └── auditService.ts
│   │   ├── workflow/               # State machine definitions
│   │   │   ├── rmaStateMachine.ts  # XState machine definition
│   │   │   └── transitions.ts      # Guard functions, permitted roles per transition
│   │   ├── repositories/           # DB access — one file per table/aggregate
│   │   │   ├── rmaRepository.ts
│   │   │   ├── lineRepository.ts
│   │   │   ├── auditRepository.ts
│   │   │   ├── attachmentRepository.ts
│   │   │   └── commentRepository.ts
│   │   ├── integrations/
│   │   │   └── merp/
│   │   │       ├── merpClient.ts   # Axios instance + retry + error mapping
│   │   │       ├── creditMemo.ts   # Stub (v1): logs call, returns shaped mock response
│   │   │       └── replacementOrder.ts  # Stub (v1)
│   │   ├── db/
│   │   │   ├── migrations/         # SQL migration files (numbered)
│   │   │   └── seeds/
│   │   └── config.ts               # Env-based config with validation (zod)
│   └── package.json
│
└── shared/                         # TypeScript types shared client + server
    ├── rma.types.ts
    ├── roles.types.ts
    └── workflow.types.ts
```

### Structure Rationale

- **features/ (client):** Keeps each domain slice self-contained — component, query hook, and types co-located. Prevents cross-feature coupling. Scales cleanly as the portal grows.
- **shared/ (client):** RBAC helpers and auth context live here because every feature needs them without coupling to each other.
- **routes/ vs services/ (server):** Routes handle only HTTP concerns (validation, auth middleware, response codes). Services own all business logic. This separation makes service logic unit-testable without starting Express.
- **workflow/ (server):** Isolated state machine layer. The state machine is the single source of truth for what transitions are legal — services ask it before executing transitions.
- **repositories/ (server):** One repository per aggregate root. Services never write SQL; repositories never know about HTTP or workflow.
- **integrations/merp/ (server):** Isolated behind an adapter. Swap stubs for live calls without touching services.

---

## Core Data Models

### RMA (Header)

```typescript
interface RMA {
  id: string;                        // UUID
  rmaNumber: string;                 // Human-readable: RMA-2026-00142
  status: RMAStatus;                 // State machine controlled
  customerId: string;                // FK → customers
  customerAccountNumber: string;     // MERP account ref
  submittedBy: string;               // FK → users
  assignedTo: string | null;         // FK → users (Returns Agent)
  branchId: string;                  // FK → branches
  sourceReferenceNumber: string;     // Customer's PO or invoice number
  returnReason: string;
  customerNotes: string | null;
  internalNotes: string | null;
  requestedDisposition: DispositionType;  // Top-level preference
  shipFromAddress: Address;
  receivingWarehouseId: string | null;
  merpCreditMemoId: string | null;   // Populated after MERP call (v2)
  merpReplacementOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  receivedAt: Date | null;
  closedAt: Date | null;
}

type RMAStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'QC_REVIEW'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'CONTESTED';
```

### RMA Line

```typescript
interface RMALine {
  id: string;                        // UUID
  rmaId: string;                     // FK → rmas
  lineNumber: number;                // 1-based, display ordering
  partNumber: string;                // MERP part number
  partDescription: string;
  quantityRequested: number;
  quantityReceived: number | null;   // Filled at warehouse receiving
  quantityApproved: number | null;   // Can differ from requested
  unitCost: number;
  returnReason: string;              // Line-level reason code
  disposition: DispositionType | null;    // Set at QC/resolution
  dispositionNotes: string | null;
  conditionOnReceipt: string | null; // Warehouse: New/Opened/Damaged/etc.
  parentLineId: string | null;       // If this line was split from another
  merpLineRef: string | null;        // MERP line reference (v2)
  createdAt: Date;
  updatedAt: Date;
}

type DispositionType =
  | 'CREDIT'
  | 'REPLACEMENT'
  | 'SCRAP'
  | 'RETURN_TO_VENDOR'
  | 'PENDING';
```

### Disposition Record

```typescript
// Separate table: immutable record of what was decided for each line
interface Disposition {
  id: string;
  rmaLineId: string;                 // FK → rma_lines
  rmaId: string;                     // Denormalized for query convenience
  dispositionType: DispositionType;
  decidedBy: string;                 // FK → users
  decidedAt: Date;
  creditAmount: number | null;
  creditMemoRef: string | null;      // MERP ref (v2)
  replacementOrderRef: string | null;
  notes: string;
}
```

### Audit Log

```typescript
// Append-only — never updated, never deleted
interface AuditLog {
  id: string;                        // UUID
  rmaId: string;                     // FK → rmas (indexed)
  rmaLineId: string | null;          // FK → rma_lines (if line-level action)
  actorId: string;                   // FK → users
  actorRole: string;                 // Snapshot of role at time of action
  action: AuditAction;               // Enum of all tracked actions
  fromStatus: RMAStatus | null;      // For state transitions
  toStatus: RMAStatus | null;
  fieldChanges: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown>; // Flexible bag for extra context
  occurredAt: Date;                  // Server-set, not client-supplied
  ipAddress: string | null;
}

type AuditAction =
  | 'RMA_CREATED'
  | 'RMA_SUBMITTED'
  | 'RMA_APPROVED'
  | 'RMA_REJECTED'
  | 'RMA_INFO_REQUIRED'
  | 'RMA_RECEIVED'
  | 'STATUS_CHANGED'
  | 'LINE_ADDED'
  | 'LINE_UPDATED'
  | 'LINE_SPLIT'
  | 'DISPOSITION_SET'
  | 'COMMENT_ADDED'
  | 'ATTACHMENT_ADDED'
  | 'MERP_CREDIT_TRIGGERED'
  | 'MERP_REPLACEMENT_TRIGGERED'
  | 'ASSIGNMENT_CHANGED'
  | 'CONTESTED'
  | 'CANCELLED';
```

### Comment / Thread

```typescript
interface Comment {
  id: string;
  rmaId: string;                     // FK → rmas
  parentCommentId: string | null;    // For threaded replies
  authorId: string;                  // FK → users
  body: string;
  visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE';
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
}
```

### Attachment

```typescript
interface Attachment {
  id: string;
  rmaId: string;                     // FK → rmas
  rmaLineId: string | null;          // If attached to a specific line
  uploadedBy: string;                // FK → users
  filename: string;                  // Original filename
  storagePath: string;               // Internal path/key — never exposed to client
  mimeType: string;
  sizeBytes: number;
  visibility: 'INTERNAL' | 'CUSTOMER_VISIBLE';
  createdAt: Date;
}
```

---

## State Machine Design

### RMA Lifecycle

```
                          ┌─────────────────────────────────────────────┐
                          │                                             │
   [Customer / Agent]     │                                             │
        creates           ▼                                             │
       ──────────►  DRAFT ──submit──►  SUBMITTED                        │
                     ▲                    │                             │
                     │                   ├──approve──►  APPROVED        │
                  reopen                 │                 │            │
                     │                   ├──reject───►  REJECTED        │
                  CONTESTED◄──contest──  │             (terminal*)      │
                     │                   └──info_req─► INFO_REQUIRED    │
                     │                                     │            │
                     └────────────────respond──────────────┘            │
                                                                        │
              APPROVED ──mark_shipped──► IN_TRANSIT                     │
                                             │                          │
                                        receive                         │
                                             ▼                          │
                                         RECEIVED                       │
                                             │                          │
                                         qc_review                      │
                                             ▼                          │
                                         QC_REVIEW                      │
                                             │                          │
                                         resolve                        │
                                             ▼                          │
                                         RESOLVED                       │
                                             │                          │
                                           close                        │
                                             ▼                          │
                                          CLOSED (terminal)             │
                                                                        │
            Any non-terminal state ──cancel──► CANCELLED (terminal)    │
                                                                        │
            * REJECTED can be contested → CONTESTED → re-enters flow ──┘
```

### Transition Table

| From | Event | To | Permitted Roles | Guards |
|------|-------|----|-----------------|--------|
| DRAFT | submit | SUBMITTED | Agent, Customer, Admin | At least 1 line exists |
| SUBMITTED | approve | APPROVED | Branch Manager, Admin | — |
| SUBMITTED | reject | REJECTED | Branch Manager, Admin | Rejection reason required |
| SUBMITTED | info_required | INFO_REQUIRED | Branch Manager, Admin, Agent | — |
| SUBMITTED | cancel | CANCELLED | Agent, Admin | — |
| INFO_REQUIRED | respond | SUBMITTED | Customer, Agent, Admin | — |
| REJECTED | contest | CONTESTED | Customer, Agent | Contest reason required |
| CONTESTED | approve | APPROVED | Branch Manager, Admin | — |
| CONTESTED | reject | REJECTED | Branch Manager, Admin | — |
| APPROVED | mark_shipped | IN_TRANSIT | Customer, Agent, Admin | — |
| APPROVED | cancel | CANCELLED | Agent, Admin | — |
| IN_TRANSIT | receive | RECEIVED | Warehouse, Admin | — |
| RECEIVED | qc_review | QC_REVIEW | QC, Admin | — |
| QC_REVIEW | resolve | RESOLVED | QC, Finance, Admin | All lines have disposition |
| RESOLVED | close | CLOSED | Finance, Admin | — |
| Any (non-terminal) | cancel | CANCELLED | Agent, Admin | — |

### State Machine Implementation Pattern

Use XState v5 (actor model) on the server. The machine is instantiated per-transition call — not persisted in memory. State is persisted in the `rmas.status` column after each valid transition.

```typescript
// server/src/workflow/rmaStateMachine.ts
import { createMachine, createActor } from 'xstate';
import { RMAStatus } from '../../shared/rma.types';

export const rmaMachine = createMachine({
  id: 'rma',
  initial: 'DRAFT',
  states: {
    DRAFT:         { on: { submit: 'SUBMITTED', cancel: 'CANCELLED' } },
    SUBMITTED:     { on: { approve: 'APPROVED', reject: 'REJECTED',
                           info_required: 'INFO_REQUIRED', cancel: 'CANCELLED' } },
    INFO_REQUIRED: { on: { respond: 'SUBMITTED', cancel: 'CANCELLED' } },
    REJECTED:      { on: { contest: 'CONTESTED' } },
    CONTESTED:     { on: { approve: 'APPROVED', reject: 'REJECTED' } },
    APPROVED:      { on: { mark_shipped: 'IN_TRANSIT', cancel: 'CANCELLED' } },
    IN_TRANSIT:    { on: { receive: 'RECEIVED', cancel: 'CANCELLED' } },
    RECEIVED:      { on: { qc_review: 'QC_REVIEW', cancel: 'CANCELLED' } },
    QC_REVIEW:     { on: { resolve: 'RESOLVED', cancel: 'CANCELLED' } },
    RESOLVED:      { on: { close: 'CLOSED' } },
    CLOSED:        { type: 'final' },
    CANCELLED:     { type: 'final' },
  },
});

// Usage in rmaService.ts:
export async function transitionRMA(rmaId: string, event: string, actor: User) {
  const rma = await rmaRepository.findById(rmaId);
  const machine = createActor(rmaMachine, { snapshot: rmaMachine.resolveState({ value: rma.status }) });
  const nextSnapshot = machine.getSnapshot();
  if (!nextSnapshot.can({ type: event })) {
    throw new InvalidTransitionError(`Cannot ${event} from ${rma.status}`);
  }
  checkRolePermitted(event, actor.role);   // throws if role not permitted
  const nextState = nextSnapshot.value;    // resolved new status
  await rmaRepository.updateStatus(rmaId, nextState);
  await auditService.log({ rmaId, action: mapEventToAction(event), fromStatus: rma.status, toStatus: nextState, actor });
}
```

---

## Architectural Patterns

### Pattern 1: Portal Embedding via Auth Token Forwarding

**What:** The host portal injects the current user's auth token (session cookie or JWT) into the RMS React app at mount time. The RMS never manages auth itself.

**When to use:** Any time the RMS is embedded inside an existing authenticated portal.

**Trade-offs:** Simple for auth continuity; RMS is dependent on host for user context. If the host portal token format changes, the RMS auth middleware must be updated.

**Example:**
```typescript
// Host portal injects via script or props:
window.__RMS_CONFIG__ = { authToken: sessionToken, userRole: currentRole };

// RMS reads at startup:
const config = window.__RMS_CONFIG__;
apiClient.defaults.headers['Authorization'] = `Bearer ${config.authToken}`;
```

### Pattern 2: RBAC as Middleware + Frontend Guard Pair

**What:** Roles are enforced at both the API level (middleware on every route) AND in the UI (conditional rendering of transitions and fields). Both must agree — never trust only the UI.

**When to use:** Any feature with role-gated actions. The authoritative check is always server-side.

**Trade-offs:** Maintenance cost of keeping server and client permission maps in sync. Mitigated by sharing the permission map from `shared/roles.types.ts`.

**Example:**
```typescript
// Server: middleware
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Client: hook
export function useCanTransition(rma: RMA, event: string): boolean {
  const { user } = useCurrentUser();
  return PERMITTED_ROLES[event]?.includes(user.role) ?? false;
}
```

### Pattern 3: Adapter Pattern for MERP Integration

**What:** All MERP calls go through a single adapter module. v1 ships stubs that match the real response contract. v2 replaces stub bodies with live HTTP calls — zero service-layer changes required.

**When to use:** Any external ERP or legacy system integration where the contract is known but the system isn't ready.

**Trade-offs:** Adds an indirection layer; worth it to decouple RMS launch from MERP integration timeline.

**Example:**
```typescript
// integrations/merp/creditMemo.ts — v1 stub
export async function createCreditMemo(payload: CreditMemoPayload): Promise<CreditMemoResult> {
  // Log that this would be called, return shaped mock
  auditLog.info('MERP stub: createCreditMemo', payload);
  return { creditMemoId: `STUB-${Date.now()}`, status: 'STUB' };
}
// v2: replace body with merpClient.post('/credit-memos', payload)
```

### Pattern 4: Append-Only Audit Log

**What:** Every state change and field edit writes an immutable row to `audit_logs`. Never update or delete audit rows. Write from the service layer, not from DB triggers.

**When to use:** All significant state changes — transitions, field edits, dispositions, comments, attachments.

**Trade-offs:** Write amplification (every action = extra row); acceptable at 500-2000 RMAs/month. Application-level write means audit calls can be tested easily. DB triggers would be harder to unit test and harder to carry rich context like actor role.

---

## Data Flow

### RMA Submission Flow

```
Customer / Agent fills form in React
    ↓
Submit button → POST /api/rmas  (with auth token in header)
    ↓
auth middleware validates token, attaches req.user
    ↓
rbac middleware verifies role can create
    ↓
Controller validates request body (zod schema)
    ↓
rmaService.createRMA() — creates RMA in DRAFT, transitions to SUBMITTED
    ↓
rmaRepository.insert() → PostgreSQL
    ↓
auditService.log(RMA_SUBMITTED, actor, ...)
    ↓
Response 201 → React Query cache updated
    ↓
UI shows new RMA in SUBMITTED state
```

### State Transition Flow

```
User clicks "Approve" button (visible only if useCanTransition returns true)
    ↓
PATCH /api/rmas/:id/transition { event: 'approve' }
    ↓
auth + rbac middleware
    ↓
rmaService.transitionRMA(id, 'approve', req.user)
    ├── Load RMA from DB
    ├── XState: verify transition is valid from current state
    ├── Check role permitted for this transition
    ├── rmaRepository.updateStatus(id, 'APPROVED')
    └── auditService.log(RMA_APPROVED, ...)
    ↓
Response 200 { rma: updatedRMA }
    ↓
React Query invalidates RMA detail query → UI re-renders with new status
```

### MERP Integration Flow (v2, stubbed in v1)

```
Finance clicks "Issue Credit" after RESOLVED
    ↓
rmaService.issueCreditMemo(rmaId, req.user)
    ├── Load RMA + approved lines
    ├── Build CreditMemoPayload from line dispositions
    ├── merpAdapter.createCreditMemo(payload)  ← stub in v1
    ├── Store returned creditMemoId on RMA record
    └── auditService.log(MERP_CREDIT_TRIGGERED, ...)
    ↓
RMA status → CLOSED after credit confirmed
```

---

## Component Boundaries

| Boundary | Communication Method | Direction | Notes |
|----------|----------------------|-----------|-------|
| Host Portal → RMS React SPA | Token injection via window global or props | Host → RMS (one-way setup) | RMS must not modify host portal state |
| RMS React SPA → RMS Node.js API | HTTP REST over same origin or configured CORS | Client → Server | Auth token in Authorization header |
| Routes → Services | Direct function call (same process) | Routes call Services | No HTTP between them |
| Services → State Machine | Function call (createActor, snapshot resolution) | Services call Machine | Machine is stateless; state from DB |
| Services → Repositories | Function call (same process) | Services call Repos | Repos return domain objects, not raw rows |
| Services → MERP Adapter | Function call (same process) | Services call Adapter | Adapter makes HTTP calls outward |
| MERP Adapter → MERP ERP | HTTP REST (external) | Adapter → MERP | v1: stubbed; v2: live |
| Repositories → PostgreSQL | SQL via Knex or pg (direct) | Repos → DB | No ORM to avoid magic; use query builder |

---

## Suggested Build Order

Build in this order to respect dependencies between components:

### Phase 1 — Foundation (no UI yet)
1. Database schema + migrations (rmas, rma_lines, audit_logs, users, roles tables)
2. Node.js project structure with Express scaffold, auth middleware, RBAC middleware
3. Repository layer (rmaRepository, lineRepository, auditRepository) with tests
4. MERP adapter stubs (no live calls) — define the contract now

**Why first:** Everything downstream depends on the database shape. Getting schema wrong is the most expensive mistake.

### Phase 2 — Core Business Logic
5. XState state machine definition — all states, transitions, guards
6. RMA service layer (createRMA, transitionRMA, updateRMA) using the state machine
7. Audit service (append-only writes triggered by all service operations)
8. Line service (add/update/split lines, set dispositions)

**Why second:** Services and the state machine are the heart of the system. They must be solid and well-tested before the UI or other consumers are built.

### Phase 3 — API Layer
9. REST routes for RMAs (CRUD + transition endpoint)
10. REST routes for lines, comments, attachments
11. Validation middleware (zod schemas at controller boundary)
12. Error handling and response shaping

**Why third:** Routes are thin wrappers over services. They cannot be built until services exist.

### Phase 4 — React Frontend Foundation
13. React project scaffold, TanStack Query setup, Axios client with token forwarding
14. Auth context (reads from host portal injection)
15. RBAC hook + ProtectedRoute + permission map (shared from server types)
16. Routing structure (React Router: /rmas, /rmas/:id, /rmas/new)

**Why fourth:** Client is a consumer of the API — build API first.

### Phase 5 — Core UI Features
17. RMA list view with filtering/search
18. RMA detail view (header + lines + status)
19. RMA creation form (multi-line)
20. Transition action buttons + confirmation dialogs
21. Audit history timeline component

### Phase 6 — Supporting Features
22. Comment threads (internal vs. customer-visible toggle)
23. Attachment upload and display
24. Dashboard and aging views

### Phase 7 — Integration + Polish
25. MERP adapter live implementation (credit memos, replacement orders)
26. Line splitting UI and backend
27. Customer self-service views (reduced permission set)
28. Role-based UI hardening (hide/disable fields per role)

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 500-2,000 RMAs/month (current) | Monolith is correct. Single Node.js server + single PostgreSQL instance handles this comfortably. No queue needed. |
| 10x growth (5K-20K RMAs/month) | Add read replicas for PostgreSQL. Index audit_logs on rmaId + occurredAt. Add Redis for session caching if host portal sessions are heavy. |
| 100K+ RMAs/month | Extract MERP integration into a background job queue (BullMQ + Redis). Consider partitioning audit_logs table by year. |

### Scaling Priority

1. **First bottleneck:** Audit log table size. Grows 10-20 rows per RMA. Partition by month or year from the start — add `PARTITION BY RANGE (occurred_at)` in the migration so it is trivially enabled later.
2. **Second bottleneck:** MERP API calls blocking request thread. Move MERP calls to background jobs (BullMQ) in v2 before going live with real integration.

---

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Controllers

**What people do:** Put transition validation, role checks, and state machine logic directly in Express route handlers because it's faster initially.

**Why it's wrong:** Controllers become untestable god-functions. Adding a second consumer (CLI tool, background job, test) means duplicating logic.

**Do this instead:** Controllers validate input and call services. Services own all business logic. Services are testable with no HTTP dependencies.

### Anti-Pattern 2: Workflow Logic Scattered in Application Code

**What people do:** Sprinkle `if (rma.status === 'SUBMITTED' && user.role === 'Manager')` checks across controllers, services, and even React components.

**Why it's wrong:** Adding a new state requires hunting down every conditional. Invalid transitions reach the database. Business rules become tribal knowledge.

**Do this instead:** One state machine definition is the single source of truth. Services ask the machine whether a transition is valid. The machine raises an error on invalid transitions before any DB write happens.

### Anti-Pattern 3: Mutable Audit Logs

**What people do:** Update audit log rows (e.g., to add a note, or to "fix" a recorded error). Sometimes implement audit as a field on the RMA row (`lastChangedBy`).

**Why it's wrong:** Destroys the audit trail's forensic value. Cannot reconstruct history. Non-compliant with most audit requirements.

**Do this instead:** Audit log rows are insert-only. Write a new row if additional context is needed. Use `oldValue`/`newValue` columns rather than overwriting.

### Anti-Pattern 4: MERP Coupling at Launch

**What people do:** Block RMS launch until MERP REST API integration is fully built and tested, because "the ERP data needs to be there."

**Why it's wrong:** MERP integration has its own timeline, change risk, and testing requirements. It blocks the whole RMS for a subsystem that isn't the core value.

**Do this instead:** Ship MERP adapter as stubs that log the call and return a shaped mock response. Define the contract now. Replace stub bodies with live calls in v2, with zero service-layer changes.

### Anti-Pattern 5: Flat Single-Table RMA (No Lines)

**What people do:** Store all return information on a single RMA row (comma-separated part numbers, a JSON blob for line items).

**Why it's wrong:** Cannot query by part number, cannot set line-level dispositions, cannot split quantities, cannot handle partial approvals. RMA lines are a first-class entity.

**Do this instead:** Separate `rmas` and `rma_lines` tables with a FK relationship. Each line has its own disposition record. This matches how every established ERP models returns (HCL Commerce: ORDRETURN / ORDRETURNITEM).

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| MERP (Custom ERP) | Adapter pattern over REST — v1 stubs, v2 live | Define request/response types now from MERP API docs. Never let raw MERP response shapes leak into service layer. |
| Host Portal Auth | Token injection at mount time; validated by auth middleware on every request | Token format must be agreed with portal team before Phase 1. |
| File Storage | Local disk (dev), object storage (prod) — abstracted behind AttachmentService | Keep storage path internal; expose signed/temporary URLs to client only. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| State Machine ↔ Service Layer | Direct function call; machine is instantiated per transition, not held in memory | Keeps state machine stateless and DB-authoritative |
| Service Layer ↔ Audit Log | Synchronous write in same DB transaction where possible | Prevents state change without audit record |
| RBAC ↔ Workflow Transitions | Both check independently: RBAC middleware checks role, workflow checks valid state | Never trust RBAC alone; always also enforce state machine guards |

---

## Sources

- [HCL Commerce ORDRETURN Table Schema](https://help.hcl-software.com/commerce/9.0.0/database/database/ordreturn.html) — MEDIUM confidence (established schema; analogous to our domain)
- [XState — Actor-based state management](https://stately.ai/docs/xstate) — HIGH confidence (official docs)
- [XState Backend State Machines](https://blogs.musadiqpeerzada.com/building-back-end-state-machines-with-xstate) — MEDIUM confidence (community, verified against XState docs)
- [Workflow Engine vs State Machine](https://workflowengine.io/blog/workflow-engine-vs-state-machine/) — MEDIUM confidence (conceptual; aligns with domain need)
- [RBAC in Node.js and React — MindBowser](https://www.mindbowser.com/role-based-access-control-node-react/) — MEDIUM confidence (community, pattern widely accepted)
- [Bulletproof Node.js Project Architecture](https://softwareontheroad.com/ideal-nodejs-project-structure) — MEDIUM confidence (widely cited community pattern)
- [Audit Logging in PostgreSQL](https://oneuptime.com/blog/post/2026-01-21-postgresql-audit-logging/view) — MEDIUM confidence (recent, January 2026)
- [RMA Process Overview — Zumasys 2025](https://www.zumasys.com/2025/03/26/tech-tip-mastering-the-rma-return-material-authorization-process-for-end-users/) — LOW confidence (operational guide, not technical architecture)
- [SAP Advanced Returns Management](https://www.xeptum.com/en/news/introduction-to-arm-in-sap-s-4hana) — LOW confidence (different stack, used for domain model validation only)

---

*Architecture research for: Returns Management System (RMA Portal) — Electronics Distributor*
*Researched: 2026-02-27*
