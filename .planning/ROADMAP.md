# Roadmap: Returns Management System (RMS)

## Overview

The RMS is built in six phases, each delivering one complete, verifiable capability. The sequence is dependency-driven: foundation infrastructure must be correct before any workflow feature is built on top of it, and the state machine must be correct before any API endpoint or UI component is built on top of it. Phases 1-3 are exclusively backend; Phases 4-6 add the full application surface that staff and customers see. Every phase ends with something a human can verify is working.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Database schema, project scaffold, auth middleware, RBAC skeleton, audit log design, and MERP adapter stubs — the infrastructure every feature depends on
- [ ] **Phase 2: Core RMA Lifecycle** - State machine, all RMA lifecycle transitions, line items with integer quantity tracking, and audit writes in the same DB transaction
- [ ] **Phase 3: Workflow and Line Operations** - REST API layer, RBAC + data-ownership enforcement, workflow queues, contest flow, finance approval, and QC inspection recording
- [ ] **Phase 4: Communication and Attachments** - Internal and customer-visible comment threads with server-enforced visibility, and document/photo attachments via presigned S3 URLs
- [ ] **Phase 5: Workspace and Dashboards** - Returns workspace with filtering and search, manager aging and exceptions dashboards, and the React frontend foundation that surfaces all prior backend work
- [ ] **Phase 6: Customer Self-Service Portal** - External customer submission, status tracking, RMA detail view, and customer-visible messaging through the portal

## Phase Details

### Phase 1: Foundation
**Goal**: The project scaffolding, database schema, and cross-cutting infrastructure are correct — before any feature is built
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05
**Success Criteria** (what must be TRUE):
  1. A Returns Agent can authenticate into the RMS using their host portal session without a second login prompt
  2. A user with the Customer role cannot access an endpoint restricted to Returns Agents — the API returns a 403 response
  3. A user at Branch A cannot retrieve an RMA belonging to Branch B — the API returns 404, not the record
  4. Every state change writes an audit event in the same database transaction — no audit record exists without its corresponding state change, and no state change exists without its corresponding audit record
  5. The MERP adapter interface compiles with typed request/response contracts for credit memo and replacement order — stub bodies return structured mock responses
**Plans**: TBD

### Phase 2: Core RMA Lifecycle
**Goal**: The complete RMA lifecycle state machine is authoritative, tested, and the only code path that writes RMA status
**Depends on**: Phase 1
**Requirements**: LCYC-01, LCYC-02, LCYC-03, LCYC-04, LCYC-05, LCYC-06, LCYC-07, LCYC-08, LCYC-09, LCYC-10, LCYC-11, LINE-01, LINE-02, LINE-03
**Success Criteria** (what must be TRUE):
  1. A Returns Agent can create a Draft RMA with multiple line items (each with part number, quantity, and reason code) and submit it — the RMA transitions to Submitted
  2. A Branch Manager can approve a Submitted RMA (transitioning to Approved), reject it with a required reason (transitioning to Rejected), or place it in Info Required — and those are the only transitions available from Submitted
  3. An attempt to transition an RMA to any state not permitted from its current state returns an error — no impossible states are reachable through the API
  4. Warehouse staff can record physical receipt on an Approved RMA using an integer received quantity per line (not a checkbox) — partial receipt is recordable
  5. QC staff can complete inspection on a Received RMA, and a Returns Agent or Finance user can resolve it — the RMA reaches Closed only after passing through QC and Resolved
**Plans**: TBD

### Phase 3: Workflow and Line Operations
**Goal**: Role-gated workflow queues, contest flow, Finance approval, QC inspection recording, and line splitting are accessible through a REST API with full RBAC and data-ownership enforcement
**Depends on**: Phase 2
**Requirements**: LINE-04, WKFL-01, WKFL-02, WKFL-03, WKFL-04, WKFL-05
**Success Criteria** (what must be TRUE):
  1. A Branch Manager sees only Submitted RMAs they are authorized to approve in their approvals queue — no cross-branch RMAs appear, and they can approve or reject directly from the queue
  2. A customer can contest a Rejected RMA by providing a dispute reason — the RMA moves to Contested, and a Branch Manager can overturn or uphold it with a documented note
  3. Finance staff can view all RMA lines with a credit disposition and approve them before the RMA transitions to Resolved
  4. QC staff can record per-line inspection results (pass/fail, findings, disposition recommendation) on a Received RMA
  5. A Returns Agent can split one RMA line into multiple lines with different dispositions or quantities — the split lines persist and the original line is replaced
**Plans**: TBD

### Phase 4: Communication and Attachments
**Goal**: Internal staff and customers can communicate on RMAs through a thread system where visibility is enforced server-side, and documents or photos can be attached and retrieved
**Depends on**: Phase 3
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, ATTC-01, ATTC-02
**Success Criteria** (what must be TRUE):
  1. A Returns Agent can add an internal note to an RMA — when that RMA is fetched by a Customer-role user, zero internal notes appear in the API response
  2. A Returns Agent can add a customer-visible message — both the agent and the submitting customer can see it in the thread
  3. A customer can reply to the customer-visible thread on their own RMA and see their reply appear
  4. A Returns Agent or Customer can upload a PDF, JPG, or PNG to an RMA — any user with access to that RMA can view and download it
**Plans**: TBD

### Phase 5: Workspace and Dashboards
**Goal**: Staff can find, filter, and understand the state of all returns through a workspace and a set of manager-level dashboards — all backed by the API and surfaced in a React frontend
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04
**Success Criteria** (what must be TRUE):
  1. A Returns Agent or Branch Manager can filter the returns workspace by status, customer, facility, and date range — the list updates to show only matching RMAs
  2. A Returns Agent or Branch Manager can search RMAs by RMA number, customer name, or part number and see matching results
  3. A Manager or Admin can view a dashboard showing return volume by status and average time an RMA spends in each state
  4. A Manager or Admin can see an exceptions view listing RMAs that are past their expected resolution time for their current state
**Plans**: TBD

### Phase 6: Customer Self-Service Portal
**Goal**: External customers can submit, track, and communicate on their own RMAs through the portal without staff assistance
**Depends on**: Phase 5
**Requirements**: CUST-01, CUST-02, CUST-03, CUST-04
**Success Criteria** (what must be TRUE):
  1. A customer can submit a new RMA through the portal — entering line items, reason codes, and attachments — without a staff member creating it on their behalf
  2. A customer can see a list of all their own submitted RMAs with current status — no other customers' RMAs appear in the list
  3. A customer can view the full detail of one of their RMAs: line items, dispositions, and audit history
  4. A customer can view the customer-visible message thread on their RMA and reply to it from the portal
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 1/4 | In Progress|  |
| 2. Core RMA Lifecycle | 0/TBD | Not started | - |
| 3. Workflow and Line Operations | 0/TBD | Not started | - |
| 4. Communication and Attachments | 0/TBD | Not started | - |
| 5. Workspace and Dashboards | 0/TBD | Not started | - |
| 6. Customer Self-Service Portal | 0/TBD | Not started | - |
