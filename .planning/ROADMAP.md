# Roadmap: Returns Management System (RMS)

## Milestones

- ✅ **v1.0 MVP** — Phases 1–3.5 (shipped 2026-02-28)
- 📋 **v1.1** — Phases 4–6 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–3.5) — SHIPPED 2026-02-28</summary>

- [x] Phase 1: Foundation (4/4 plans) — completed 2026-02-27
- [x] Phase 2: Core RMA Lifecycle (5/5 plans) — completed 2026-02-27
- [x] Phase 3: Workflow and Line Operations (4/4 plans) — completed 2026-02-27
- [x] Phase 3.5: Lifecycle HTTP Controller *(INSERTED — gap closure)* (3/3 plans) — completed 2026-02-28

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 📋 v1.1 (Planned)

- [ ] **Phase 4: Communication and Attachments** - Internal and customer-visible comment threads with server-enforced visibility, and document/photo attachments via presigned S3 URLs
- [ ] **Phase 5: Workspace and Dashboards** - Returns workspace with filtering and search, manager aging and exceptions dashboards, and the React frontend foundation that surfaces all prior backend work
- [ ] **Phase 6: Customer Self-Service Portal** - External customer submission, status tracking, RMA detail view, and customer-visible messaging through the portal

## Phase Details

### Phase 4: Communication and Attachments
**Goal**: Internal staff and customers can communicate on RMAs through a thread system where visibility is enforced server-side, and documents or photos can be attached and retrieved
**Depends on**: Phase 3 (v1.0 complete)
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

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 4/4 | Complete | 2026-02-27 |
| 2. Core RMA Lifecycle | v1.0 | 5/5 | Complete | 2026-02-27 |
| 3. Workflow and Line Operations | v1.0 | 4/4 | Complete | 2026-02-27 |
| 3.5. Lifecycle HTTP Controller *(gap closure)* | v1.0 | 3/3 | Complete | 2026-02-28 |
| 4. Communication and Attachments | v1.1 | 0/TBD | Not started | - |
| 5. Workspace and Dashboards | v1.1 | 0/TBD | Not started | - |
| 6. Customer Self-Service Portal | v1.1 | 0/TBD | Not started | - |
