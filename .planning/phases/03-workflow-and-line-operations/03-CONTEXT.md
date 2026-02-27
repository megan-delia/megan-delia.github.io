# Phase 3: Workflow and Line Operations - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Role-gated workflow queues (Branch Manager approvals, Finance credit approvals, QC inspection recording) and line-level operations (line splitting) exposed through a REST API with RBAC and data-ownership enforcement. State machine extensions (CONTESTED state) are part of this phase. Creating the HTTP controller layer and request/response DTOs is in scope. Frontend is out of scope.

</domain>

<decisions>
## Implementation Decisions

### Contest flow mechanics
- Contesting a REJECTED RMA introduces a new **CONTESTED** state in the state machine (REJECTED → CONTESTED)
- **Overturn:** Branch Manager overturns → RMA transitions CONTESTED → APPROVED
- **Uphold:** Branch Manager upholds → RMA transitions CONTESTED → CLOSED (final; rejection stands)
- **One contest per RMA only** — once upheld and closed, no further contesting is possible
- Both the dispute reason (from customer) and the manager's resolution note are required fields

### Approval queue scoping
- The Branch Manager approvals queue returns **header-level summary** per item: RMA number, submitting agent name, customer name/ID, submission date, line count, total ordered quantity
- Default sort: **oldest first** (FIFO — prevents older submissions being buried)
- If a manager oversees multiple branches: **combined queue with optional branch filter** — one endpoint, `?branchId=` filter param
- The same approvals queue endpoint returns **both SUBMITTED and CONTESTED** RMAs (manager has one place to check for pending decisions); caller can filter by status

### Finance credit approval gate
- Finance approval is at the **line level** — each credit-disposition line is approved individually
- The `resolve()` transition is **hard-blocked** if any credit line lacks Finance approval (all credit lines must be approved before RESOLVED)
- If a line's disposition changes away from CREDIT after Finance approved it, the Finance approval is **cleared** (approval was for the credit decision; changing disposition invalidates it)
- Finance gets a **dedicated queue endpoint** (`/finance/credit-approvals`) returning all lines with CREDIT disposition and no Finance approval, scoped to QC_COMPLETE RMAs

### Line split rules
- **Quantity conservation is required** — the sum of all split line quantities must equal the original line's ordered quantity exactly
- **Split lines can have different reason codes** (not just different dispositions/quantities) — full independent line definition per split
- **Minimum 2 lines** must result from a split; **no maximum**
- Line splitting is only allowed when lines are editable: **DRAFT and INFO_REQUIRED states only** (same LINE_EDITABLE_STATUSES guard as Phase 2 — no special case)
- The original line is replaced by the split lines; the original line record is removed

### Claude's Discretion
- QC inspection recording payload structure (pass/fail fields, findings text, disposition recommendation) — implement per REQUIREMENTS.md spec
- HTTP route naming conventions (stay consistent with Phase 2 patterns)
- Error response shapes for new guard violations (contest-when-not-rejected, split-quantity-mismatch, etc.)
- Pagination implementation for queue endpoints

</decisions>

<specifics>
## Specific Ideas

- The approvals queue and Finance queue should follow the same structural pattern — consistent API surface for queue-style endpoints
- "One contest per RMA" is enforced at the service layer, not just the state machine — the service should check for a prior contest attempt before allowing the transition

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-workflow-and-line-operations*
*Context gathered: 2026-02-27*
