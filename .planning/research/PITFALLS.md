# Pitfalls Research

**Domain:** B2B Returns Management System / RMA Portal — Electronics Distributor
**Researched:** 2026-02-27
**Confidence:** MEDIUM (domain patterns from verified sources; RMA-specific implementation specifics cross-referenced against state machine, ERP integration, and portal embedding literature)

---

## Critical Pitfalls

### Pitfall 1: State Machine Without a Single Source of Truth

**What goes wrong:**
Transition logic is spread across API route handlers, frontend components, and database triggers rather than living in one explicit state machine module. Two code paths can independently move a record from `Submitted` to `Approved`, or worse, from `Approved` back to `Draft`, because there is no central guard enforcing valid transitions. Teams discover this in production when an RMA appears in an impossible state — e.g., `Closed` but without a QC record, or `In Transit` but still showing `Draft` to the customer.

**Why it happens:**
Developers add transition logic where it's convenient — a PATCH endpoint here, a background job there. Without an explicit transition table (allowed: `[from, to, role, conditions]`), each feature adds its own state-change code and the invariants rot silently.

**How to avoid:**
Centralize all state transitions in a single `RMAStateMachine` module on the Node.js backend. This module is the only code that may write to the `status` column. Every transition is declared explicitly:
```
{ from: 'Submitted', to: 'Approved', allowedRoles: ['returns_agent', 'branch_manager'], guards: [requiresAtLeastOneLine] }
{ from: 'Approved', to: 'In Transit', allowedRoles: ['warehouse'], guards: [requiresShippingLabel] }
```
All API endpoints call `stateMachine.transition(rmaId, newStatus, actorContext)` — never write status directly. Reject any transition not in the table with a 422 and log the attempt.

**Warning signs:**
- `status` field is updated in more than one location in the codebase
- Frontend sends a `PATCH /rmas/:id` with `{ status: "Approved" }` directly
- No tests that explicitly verify invalid transitions are rejected
- QA finds RMAs in states that "shouldn't be possible"

**Phase to address:**
Core RMA Lifecycle (state machine foundation phase) — must be established before any status-changing feature is built.

---

### Pitfall 2: ERP Integration Coupling That Blocks the Launch

**What goes wrong:**
The team designs the credit memo and replacement order flows as synchronous, tightly coupled calls to MERP. When MERP's API isn't ready, the entire RMS is blocked. Or worse: the team launches with live MERP calls, MERP is unstable, and every RMS `Resolved` action fails. Alternatively, stubs are built but the contract (request/response shape, error codes, idempotency behavior) is never formalized — when real MERP integration is wired in Phase 2, the stubs didn't match MERP's actual API and everything has to be reworked.

**Why it happens:**
Teams either skip the stub layer entirely ("we'll just hit MERP directly") or build stubs that are too loose ("we'll figure out the contract later"). Neither prepares for real integration.

**How to avoid:**
Design the MERP integration layer as an explicit adapter interface on Day 1:
```typescript
interface MERPAdapter {
  createCreditMemo(rmaId: string, lines: CreditLine[]): Promise<MERPResult>
  createReplacementOrder(rmaId: string, lines: ReplacementLine[]): Promise<MERPResult>
}
```
V1 ships a `MERPStubAdapter` that logs calls and returns fixture responses. V2 swaps in `MERPLiveAdapter` behind the same interface. Record every outbound call (payload, timestamp, response) in a `merp_integration_log` table — this becomes the paper trail for debugging when real integration goes live. Negotiate and lock the MERP request/response contract in writing before writing the stub, not after.

**Warning signs:**
- MERP API calls are made inline inside route handlers rather than via an adapter
- Stub responses are hardcoded strings, not structured objects matching the expected MERP schema
- No `merp_integration_log` table in the schema
- The question "what does MERP return if a credit memo already exists for this RMA?" has no answer

**Phase to address:**
Foundation/Infrastructure phase — adapter interface must be in place before any disposition or resolution flow is built.

---

### Pitfall 3: RBAC That Only Checks Role, Not Data Ownership

**What goes wrong:**
Access control checks that a user has the `returns_agent` role but does not check whether that agent's branch matches the RMA's branch. A Returns Agent at Branch A can read, modify, or close RMAs belonging to Branch B. External customers can enumerate other customers' RMAs by incrementing ID in the URL. Finance can approve dispositions that require QC sign-off. The system looks complete because every endpoint has an auth middleware — but the middleware only validates role, not resource ownership.

**Why it happens:**
Role checking is the first thing teams implement and it feels sufficient. Data-level scoping (also called row-level security or resource ownership) is treated as a later concern and then forgotten.

**How to avoid:**
Every RMA query must include an ownership filter in addition to role check:
```typescript
// Wrong: role check only
if (user.role !== 'returns_agent') throw 403;
const rma = await db.rma.findById(rmaId);

// Correct: role + ownership
if (user.role !== 'returns_agent') throw 403;
const rma = await db.rma.findById(rmaId, { branchId: user.branchId });
if (!rma) throw 404; // don't leak existence
```
External customer queries must always filter by `customerId`. Define a permission matrix (role × action × resource scope) as a documented artifact before writing authorization code. Test each role explicitly: create an RMA for Customer A, log in as Customer B, verify 404.

**Warning signs:**
- RMA IDs are sequential integers (enumerable)
- No `branchId` or `customerId` filter in the RMA list query
- All "unauthorized access" tests only test unauthenticated requests, not cross-customer requests
- Role explosion: more than 8 roles have been defined and some are "read_only_returns_agent_branch_a"

**Phase to address:**
Auth/RBAC phase — ownership scoping must be part of the initial data model and query layer, not retrofitted.

---

### Pitfall 4: Multi-Line Quantity Bugs from Race Conditions and Missing Partial-State Tracking

**What goes wrong:**
A single RMA contains 5 lines. Line 3 is partially received — 6 of 10 units arrive in the first shipment. The system has no `received_qty` field, only a boolean `received`. When the remaining 4 units arrive, there is no mechanism to record the partial receipt, so the warehouse marks the line as fully received prematurely — or marks it not received and the remaining units are lost. Separately, two warehouse staff attempt to update the same line simultaneously and one update overwrites the other (last-write-wins with no optimistic locking).

**Why it happens:**
Designers think of lines as atomic (received / not received) because that's simpler to model. Partial receipts are an afterthought. Optimistic locking is skipped because "only one person should be working this RMA."

**How to avoid:**
Model quantities explicitly from the start:
```sql
rma_lines: id, rma_id, sku, requested_qty, approved_qty, received_qty, disposition, disposition_qty
```
Never store a boolean where a quantity belongs. Implement optimistic locking on line updates using a `version` column — reject updates where `version` does not match current DB value. Disposition must be recorded per line with its own quantity (a single line can be split: 4 units credit, 2 units scrap). Write integration tests that exercise partial receipt across two separate warehouse update calls.

**Warning signs:**
- RMA line model has `is_received: boolean` instead of `received_qty: integer`
- Disposition is a single field on the RMA header, not per-line
- No `version` or `updated_at` concurrency guard on line update endpoints
- No test for: "warehouse updates line 3, then another warehouse user updates line 3 before the first is saved"

**Phase to address:**
Core data model phase (before any warehouse or disposition feature is built).

---

### Pitfall 5: Audit Log as an Afterthought

**What goes wrong:**
Audit logging is added after the core workflow is built, by wrapping existing endpoints with a logging middleware. This produces logs that record HTTP method + path + user ID — which is technically "audit log" but useless for the actual use case: "who changed the disposition on line 2 of RMA-1045 from credit to scrap, and when?" The log shows `PATCH /rmas/1045` with no record of what changed. When Finance disputes a credit memo or a customer contests a decision, there is no defensible paper trail.

**Why it happens:**
Audit logging feels like infrastructure rather than a feature, so it gets deferred. When added late, the data model doesn't surface field-level diffs cleanly.

**How to avoid:**
Design the audit log schema before the first workflow feature:
```sql
audit_events: id, rma_id, line_id (nullable), actor_id, actor_role,
              action, -- enum: status_changed, disposition_set, line_added, note_added, attachment_uploaded, etc.
              old_value (jsonb), new_value (jsonb),
              occurred_at, ip_address
```
Every state machine transition must write an audit event — not optionally, but as part of the same database transaction. Audit events are immutable — no UPDATE or DELETE ever touches this table. Internal notes and customer-visible communications are separate tables, each with their own audit trail. Verify the log tells a complete story by writing a test that replays 10 actions on an RMA and reconstructs the full history from the audit table alone.

**Warning signs:**
- Audit logging is implemented as Express middleware after the fact
- The audit table does not have `old_value` / `new_value` columns
- Audit writes are in a separate transaction from the state change (they can diverge)
- Line-level actions are not distinguishable from header-level actions in the log

**Phase to address:**
Foundation/data model phase — schema must exist before the first workflow transition is implemented.

---

### Pitfall 6: Portal Embedding Auth Breaks with Third-Party Cookie Deprecation

**What goes wrong:**
The RMS React app is embedded inside the existing Master Electronics portal. Authentication relies on session cookies from the parent portal being passed to the embedded app's API. Chrome's third-party cookie deprecation (fully enforced in 2024+) blocks these cookies when the RMS is served from a different subdomain or path than the parent portal. The embedded app silently fails auth checks, surfaces a login screen inside the portal frame, or worse — makes unauthenticated requests that return 401s and the user sees a broken UI with no clear error.

**Why it happens:**
Local development doesn't hit cross-origin cookie restrictions (both apps run on localhost). The issue only appears in staging/production where the parent portal and RMS have different origins.

**How to avoid:**
Do not rely on cookie passthrough for embedded auth. Use one of these patterns:
1. **Token handoff via postMessage**: Parent portal obtains an auth token and passes it to the embedded React app via `window.postMessage`. The RMS stores it in memory (not localStorage, which persists beyond session) and attaches it as a Bearer token on all API calls.
2. **Shared subdomain with SameSite=Lax cookies**: Serve both parent portal and RMS API under the same domain (e.g., `portal.masterelectronics.com` and `portal.masterelectronics.com/rms-api`). Cookies with `SameSite=Lax` are not blocked.
3. **Same identity provider**: Both apps validate against the same JWT issuer. The parent passes the JWT to the RMS, which validates it independently.

Test the embed in a staging environment with Chrome's third-party cookie blocking enabled from Day 1, not post-launch.

**Warning signs:**
- The RMS API relies on `req.session` from the parent portal's session store
- Local dev and staging behave differently for auth
- No explicit test for "embedded app receives a valid auth context from parent portal"
- Auth design is "we'll figure it out when we integrate"

**Phase to address:**
Portal integration / auth phase — before any feature development that involves the embedded context.

---

### Pitfall 7: Communication Thread Visibility Leakage (Internal Notes Exposed to Customers)

**What goes wrong:**
The system supports internal-only notes (e.g., "Customer is disputing but their RMA is outside warranty — hold firm") and customer-visible messages. A bug in the query — an incorrect filter, a missing `WHERE visibility = 'internal'` clause, or a frontend rendering mistake — exposes internal notes in the customer-facing thread view. For a distributor handling sensitive supplier relationships or dispute strategy, this is a serious trust violation.

**Why it happens:**
Internal vs. external visibility is often modeled as a boolean flag on a single `comments` table. API endpoints that return comments for external customers apply the filter inconsistently — sometimes it's in the query, sometimes the frontend is supposed to filter, sometimes neither.

**How to avoid:**
Model internal and external threads as separate entities from the start, or enforce visibility at the data access layer:
```typescript
// Never trust the caller to filter visibility
async getCustomerVisibleThread(rmaId, customerId) {
  // ownership check + visibility filter both in query
  return db.comments.findAll({ rmaId, customerId, visibility: 'external' });
}
async getInternalThread(rmaId, actorRole) {
  if (!INTERNAL_ROLES.includes(actorRole)) throw 403;
  return db.comments.findAll({ rmaId }); // all visibility
}
```
Never return the raw comment list to a frontend and rely on the frontend to hide internal notes. Write a test: log in as a customer, hit the comment API, assert no `visibility: 'internal'` records appear in the response.

**Warning signs:**
- A single API endpoint returns all comments and the frontend filters by visibility
- The `visibility` field is present in the database but not enforced in any query WHERE clause
- No automated test that logs in as an external customer and checks for internal note leakage

**Phase to address:**
Communication threads feature phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Status field updated directly in route handlers | Faster to ship first feature | State machine impossible to enforce; invalid states accumulate | Never — establish state machine module on Day 1 |
| MERP stubs that return hardcoded strings (not structured objects) | Unblocks development quickly | Stubs don't match real MERP schema; real integration requires full rewrite of consuming code | Never — stubs must match the negotiated contract |
| Sequential integer RMA IDs | Simpler to read, easier to debug | Customer can enumerate other customers' RMAs | Use UUIDs or prefixed IDs (e.g., RMA-2024-00103) for external exposure |
| Single `comments` table with visibility flag, frontend filters | Simpler schema | Internal notes leak risk; filter logic scattered | Never for visibility — enforce at query layer |
| Boolean `is_received` instead of `received_qty` | Simpler model | Partial receipts impossible to track; requires schema migration mid-project | Never — model quantities from the start |
| Audit log written in a separate transaction from state change | Simpler code | Audit and state can diverge (state changes without audit record) | Never — audit must be atomic with the action |
| Lazy loading all RMA lines with comments and attachments on list view | Easy to implement | N+1 query disaster at 500+ RMAs/month volume | Never on list endpoints — use summary projections |
| Store attachments as database BLOBs | No external dependency | Database bloat, backup size explosion, no CDN delivery, no malware scanning pipeline | Never — use object storage (S3-compatible) from the start |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MERP credit memo creation | Call MERP synchronously in the `Resolved` state transition; if MERP is down, the RMA cannot be resolved | Decouple: transition to `Resolved`, enqueue MERP call, process asynchronously with retry. Log attempt + result in `merp_integration_log` |
| MERP replacement order | Assume MERP is idempotent; call it multiple times on retry | MERP may not be idempotent. Store the MERP-returned reference ID immediately. Check for existing reference before re-calling |
| MERP credit memo | Build stub that accepts any payload | Negotiate and document the exact MERP request/response schema before writing stubs; validate stubs against schema |
| Parent portal auth (embedded) | Rely on session cookie passthrough | Use postMessage token handoff or shared-domain cookie strategy; validate in E2E tests under production-like cookie policy |
| File attachment upload | Upload directly to backend API which proxies to S3 | Use pre-signed S3 URLs for direct client upload; scan for malware post-upload before marking attachment as available |
| Attachment access | Store S3 URL directly in DB and return it to client | Generate pre-signed download URLs per-request with short TTL; never expose the bucket URL directly |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading full RMA with all lines + comments + attachments on list view (N+1) | Dashboard loads slowly; 50+ SQL queries per page load visible in query log | Use summary projections on list endpoints (id, status, customer, line count, latest action). Load detail only on drill-down | ~100 concurrent RMAs on the list view |
| Offset-based pagination on high-volume RMA list | Page 50+ loads noticeably slower than Page 1; timeouts on exports | Use cursor-based pagination (keyset) for the main list. Separate export endpoint with streaming | ~5,000 total RMA records |
| No database index on `status`, `customer_id`, `branch_id`, `created_at` | Filters and search work fine in dev; production degrades as volume grows | Add indexes for all filter and sort columns at schema creation time | ~10,000 RMA records |
| Audit log table with no partitioning or archival strategy | Audit queries slow down as log grows; backups take longer | Partition audit_events by month or year. Archive resolved/closed RMAs' events to cold storage after 2 years | ~2 years at 1,000 RMAs/month × avg 20 events/RMA = 480K rows/year |
| Re-rendering the full React RMA list on any status update | UI feels laggy on dashboard with 200+ rows | Normalize state in React (React Query or Zustand); update only the changed record, not the full list | 50+ rows visible on screen |
| Synchronous MERP API call in request-response cycle | `Resolve` button spinner hangs for 10+ seconds; timeout errors if MERP is slow | Async MERP calls with job queue (e.g., BullMQ). Immediately return 202 Accepted, update status when MERP confirms | Every time MERP response time exceeds 3 seconds |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| External customer can access any RMA by ID (IDOR) | Customer A reads, modifies, or closes Customer B's RMAs | Every query for external users filters by `customerId`; IDs should not be sequential integers |
| Internal notes returned to customer API endpoint | Sensitive dispute strategy, supplier info exposed to customer | Enforce visibility filter at query layer, never at frontend; automated test verifies no internal note leakage |
| Attachments stored in public S3 bucket | Anyone with the URL can download customer return documents | Private bucket only; pre-signed URLs with 15-minute TTL for downloads |
| No malware scanning on uploaded attachments | Malware distributed to internal staff who download "photo of defective part" | Scan uploads post-receipt (AWS GuardDuty Malware Protection for S3 or equivalent); quarantine until scan completes; never serve unscanned files |
| MERP adapter accepts RMA ID as path param without validation | Path traversal or SSRF if MERP URL is constructed from user input | Validate all IDs server-side before constructing MERP requests; MERP adapter interface should accept typed objects, not raw strings |
| Auth token stored in localStorage in embedded portal | XSS in parent portal extracts token from localStorage | Store token in memory (React state / context) only; if persistence needed, use httpOnly cookie with SameSite=Strict |
| Role checked but transition not validated against allowed-roles matrix | A Finance user calls the API directly (bypassing UI) to move an RMA from `QC` to `Closed` | State machine module enforces allowed roles per transition, not just middleware role check |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Forcing complete re-entry when RMA submission has incomplete info | Customer abandons the return; agent manually re-enters data | Implement `Info Required` state where agent can request specific missing fields; customer completes inline without restarting |
| No visibility into what the customer is waiting for | Customers call support repeatedly: "where is my RMA?" | Customer portal shows current state, next expected action, and who has the ball (customer vs. internal) |
| Disposition shown only to internal roles; customer sees generic "Resolved" | Customer doesn't know if they're getting credit, replacement, or nothing | Customer-visible disposition summary at resolution; communicate via customer-visible thread before closing |
| Branch Manager sees all branches' RMAs because role check passes | Manager in Branch A confused by Branch B data; potential data leak | Default list view scoped to user's branch; explicit override (with audit event) for Admin access across branches |
| RMA list has no saved filters or shareable URLs | Returns Agent re-applies same filter every session; cannot share a filtered view with a colleague | Encode filter state in URL query params so views are bookmarkable and shareable |
| Internal note UI looks identical to customer-visible message UI | Agent accidentally sends internal dispute notes to customer | Clear, persistent visual distinction between internal and external compose; require explicit confirmation for external send |

---

## "Looks Done But Isn't" Checklist

- [ ] **State machine:** Verify that a direct `PATCH /rmas/:id { status: "Closed" }` from a role that shouldn't close returns 422, not 200
- [ ] **RBAC data scoping:** Log in as Customer A, attempt to GET `/rmas/:id` for Customer B's RMA — verify 404 (not 403, which leaks existence)
- [ ] **Internal note isolation:** Log in as external customer, GET `/rmas/:id/comments` — verify zero records with `visibility: "internal"` in response
- [ ] **Partial receipt:** Create an RMA line with qty 10, receive 6, verify `received_qty = 6` not `is_received = true`; receive remaining 4, verify `received_qty = 10`
- [ ] **Audit completeness:** Perform 10 actions on one RMA, query audit_events — verify every action is recorded with actor, old_value, new_value, and timestamp
- [ ] **MERP stub contract:** The stub adapter's request payload shape and response shape exactly match the documented MERP API contract
- [ ] **Attachment access:** Upload a file, copy the URL, log out, attempt to access the URL — verify access is denied (not public)
- [ ] **Portal auth in embedded context:** Load the RMS embedded in the parent portal under production-like cookie policy — verify auth works without requiring a second login
- [ ] **Concurrency on line update:** Simulate two simultaneous updates to the same RMA line — verify one succeeds and one returns a conflict error, not silent data loss
- [ ] **Communication thread:** Resolve an RMA where agent sent one internal note and one customer-visible note — verify customer portal shows only the external note

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| State machine not centralized (status written in N places) | HIGH | Audit all code paths that write `status`; freeze feature work; centralize in state machine module; write migration to validate all existing RMA states are valid; re-test all workflows |
| MERP stubs don't match real MERP contract | MEDIUM | Negotiate actual contract with MERP team; rewrite stub adapter to match; run integration tests against MERP sandbox; validate all disposition/resolution flows before enabling live calls |
| RBAC missing data ownership scoping | HIGH | Add ownership filters to every RMA query; add integration tests for cross-customer access; audit logs to detect if any cross-customer access occurred in production; notify security team |
| Audit log added too late (no field-level diffs) | MEDIUM | Migrate existing table to add `old_value`/`new_value`; backfill is impossible for historical events — document gap; ensure all net-new transitions write full diffs |
| Attachment public bucket exposure | HIGH | Immediately set bucket to private; rotate pre-signed URL generation; audit S3 access logs for unauthorized downloads; notify affected customers if sensitive documents were exposed |
| Multi-line qty tracked as boolean | MEDIUM | Schema migration to add `received_qty`, `disposition_qty` columns; data migration to populate from existing boolean (all `is_received=true` → `received_qty = requested_qty`); regression test all warehouse and QC flows |
| Internal notes leaked to customers | HIGH | Immediate hotfix to add visibility filter to customer-facing comment endpoint; audit access logs to determine scope of leakage; notify affected customers; post-mortem |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| State machine not centralized | Phase: Core RMA Lifecycle (state machine) | Integration test: every invalid transition returns 422 |
| ERP integration coupling | Phase: Foundation / Infrastructure | Interface + stub in place before first disposition feature ships |
| RBAC missing data scoping | Phase: Auth / RBAC | Test: Customer A cannot access Customer B's RMA |
| Multi-line quantity bugs | Phase: Core data model | Schema reviewed: all quantities are integers, no boolean received flags |
| Audit log as afterthought | Phase: Foundation / data model | Audit table schema defined before first state transition is implemented |
| Portal embedding auth breakage | Phase: Portal integration / auth | E2E test in staging with third-party cookies blocked |
| Internal note visibility leakage | Phase: Communication threads | Automated test: external customer API returns zero internal notes |
| N+1 queries on RMA list | Phase: Core RMA list / dashboard | Load test with 1,000 RMA records; verify list endpoint makes ≤5 queries |
| MERP stub contract mismatch | Phase: MERP integration (stubs) | Stub adapter validated against documented MERP schema before v1 ships |
| Attachment public bucket | Phase: Attachment/document repository | Penetration test: attachment URL returns 403 without valid pre-signed params |

---

## Sources

- [RMA Process Best Practices — Qualityze](https://www.qualityze.com/blogs/return-merchandise-authorization) — operational pitfalls, data silos, incomplete submissions
- [RMA Best Practices for Retailers — ReturnPro](https://www.returnpro.com/resources/blog/rma-return-process-6-best-return-management-practices-for-retailers-brands-and-3p-marketplace-sellers) — process gaps and transparency issues
- [Warranty Claims and RMA Management for High-Tech Companies — ServiceTarget](https://www.servicetarget.com/blog/warranty-claims-and-rma-management-for-high-tech-companies) — warranty vs. ticket treatment mistake, disposition data capture
- [Why Developers Never Use State Machines — WorkflowEngine](https://workflowengine.io/blog/why-developers-never-use-state-machines/) — state machine implementation resistance and pitfalls
- [Modelling Workflows With Finite State Machines — Lloyd Atkinson](https://www.lloydatkinson.net/posts/2022/modelling-workflows-with-finite-state-machines-in-dotnet/) — transition table design, invalid state prevention
- [Mistakes Made When Adopting Event Sourcing — Anes Hasicic / Medium](https://aneshas.medium.com/mistakes-made-when-adopting-event-sourcing-and-how-we-recovered-ddd-eu-2020-talk-summary-7e25f1eb890a) — audit log design, transaction atomicity, schema migration
- [Event Sourcing Fails: 5 Real-World Lessons — Kite Metric](https://kitemetric.com/blogs/event-sourcing-fails-5-real-world-lessons) — audit replay complexity, GDPR challenges
- [RBAC Pitfalls — Pathlock](https://pathlock.com/blog/role-based-access-control-rbac/) — role explosion, role creep, granularity mistakes
- [SSO with Iframe Embed — Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2284861/implementing-sso-with-entra-external-id-in-embedded-applications-post-third-party-cookie-deprecation) — third-party cookie deprecation impact on embedded apps
- [Authing within an IFrame — react-oidc-context GitHub](https://github.com/authts/react-oidc-context/issues/1408) — postMessage vs. storage for embedded auth
- [S3 Malware Risks — Orca Security](https://orca.security/resources/blog/the-risks-of-malware-in-storage-buckets/) — attachment storage security, malware in storage buckets
- [AWS GuardDuty Malware Protection for S3](https://aws.amazon.com/blogs/security/using-amazon-guardduty-malware-protection-to-scan-uploads-to-amazon-s3/) — upload scanning pipeline
- [B2B ERP Integration Best Practices — CoderRapper](https://coderapper.com/article/erp-supply-chain/b2b-erp-integration/) — ERP coupling, integration timeline risks
- [Contract Testing with Pact — CoderSociety](https://codersociety.com/blog/articles/contract-testing-pact) — stub contract validation approach
- [Server-Side Pagination React + Node.js — Medium](https://medium.com/@akhilanand.ak01/implementing-server-side-pagination-in-react-with-node-js-and-express-417d1c480630) — pagination performance at scale

---

*Pitfalls research for: B2B Returns Management System / RMA Portal — Electronics Distributor*
*Researched: 2026-02-27*
