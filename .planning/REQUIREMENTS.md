# Requirements: Returns Management System (RMS)

**Defined:** 2026-02-27
**Core Value:** Every return moves faster — from submission to resolution — because every person involved can see exactly where it is and what's blocking it.

## v1 Requirements

### Foundation

- [x] **FOUND-01**: User authenticates into the RMS via the host portal's JWT without a separate login
- [x] **FOUND-02**: System enforces role-based access for 6 internal roles (Returns Agent, Branch Manager, Warehouse, QC, Finance, Admin) and external Customer role
- [x] **FOUND-03**: System enforces data-ownership scoping — users can only access RMAs belonging to their branch or customer account (not just role-level gating)
- [x] **FOUND-04**: System writes an append-only audit log entry (actor, role, timestamp, action, old value, new value) atomically with every state change and data modification
- [x] **FOUND-05**: System exposes typed MERP adapter stubs for credit memo creation and replacement order creation with defined request/response contracts

### Lifecycle

- [x] **LCYC-01**: Returns Agent can create a new RMA in Draft status
- [x] **LCYC-02**: Returns Agent or Customer can submit a Draft RMA, transitioning it to Submitted
- [x] **LCYC-03**: Branch Manager can approve a Submitted RMA, transitioning it to Approved
- [x] **LCYC-04**: Branch Manager can reject a Submitted RMA with a required reason, transitioning it to Rejected
- [x] **LCYC-05**: Returns Agent can place an RMA in Info Required status to request additional information from the submitter without hard-rejecting
- [x] **LCYC-06**: Customer or staff can respond to an Info Required request, returning the RMA to Submitted
- [x] **LCYC-07**: Warehouse staff can record physical receipt of goods on an Approved RMA, transitioning it to Received
- [x] **LCYC-08**: QC staff can complete inspection on a Received RMA, transitioning it to QC status
- [x] **LCYC-09**: Returns Agent or Finance can resolve a QC-complete RMA, transitioning it to Resolved
- [x] **LCYC-10**: Returns Agent or Admin can close a Resolved RMA, transitioning it to Closed
- [x] **LCYC-11**: Returns Agent or Admin can cancel an RMA in Draft, Submitted, or Approved status with a required cancellation reason

### Line Items

- [x] **LINE-01**: Returns Agent can add multiple line items to an RMA, each with part number, quantity, and structured reason code
- [x] **LINE-02**: Each RMA line can be assigned a disposition type: credit, replacement, scrap, or RTV
- [x] **LINE-03**: System tracks received quantity and QC-inspected quantity as integers per line (not boolean flags), enabling partial receipt
- [ ] **LINE-04**: Returns Agent can split one RMA line into multiple lines with different dispositions or quantities

### Workflow

- [ ] **WKFL-01**: Branch Manager can view an approvals queue of all Submitted RMAs awaiting their decision and approve or reject from it
- [ ] **WKFL-02**: Customer can contest a Rejected RMA by providing a dispute reason, transitioning it to Contested
- [ ] **WKFL-03**: Branch Manager can review a Contested RMA and either overturn (→ Approved) or uphold (→ Rejected with a final documented note)
- [ ] **WKFL-04**: Finance staff can view and approve credit-disposition lines before an RMA transitions to Resolved
- [ ] **WKFL-05**: QC staff can record per-line inspection results (pass/fail, findings, disposition recommendation) on a Received RMA

### Communication

- [ ] **COMM-01**: Returns Agent can add internal notes to an RMA that are visible only to internal staff roles
- [ ] **COMM-02**: Returns Agent can add customer-visible messages to an RMA that are visible to both internal staff and the submitting customer
- [ ] **COMM-03**: Customer can add messages to the customer-visible thread on their own RMAs
- [ ] **COMM-04**: System enforces message visibility server-side — internal notes are never returned in API responses for Customer-role requests

### Attachments

- [ ] **ATTC-01**: Returns Agent or Customer can upload documents or photos to an RMA (supported: PDF, JPG, PNG)
- [ ] **ATTC-02**: Users can view and download attachments on any RMA they have access to

### Dashboards

- [ ] **DASH-01**: Returns Agent and Branch Manager can view a returns workspace listing all accessible RMAs with filter by status, customer, facility, and date range
- [ ] **DASH-02**: Returns Agent and Branch Manager can search RMAs by RMA number, customer name, or part number
- [ ] **DASH-03**: Manager and Admin can view a dashboard showing return volume by status and average time in each state (aging)
- [ ] **DASH-04**: Manager and Admin can view an exceptions view highlighting RMAs past expected resolution time per state

### Customer Portal

- [ ] **CUST-01**: Customer can submit a new RMA through the portal without staff assistance
- [ ] **CUST-02**: Customer can view a list of all their own submitted RMAs and current status
- [ ] **CUST-03**: Customer can view the detail of their own RMA including line items, dispositions, and audit history
- [ ] **CUST-04**: Customer can view and reply to customer-visible messages on their own RMAs

## v2 Requirements

### MERP Live Integration

- **MERP-01**: System creates a credit memo in MERP when a credit disposition is resolved and approved
- **MERP-02**: System creates a replacement order in MERP when a replacement disposition is resolved and approved
- **MERP-03**: MERP integration events are logged with request/response payloads for reconciliation

### Supplier Returns

- **SUPP-01**: Supplier return/claim can be created with its own lifecycle separate from customer RMAs
- **SUPP-02**: Supplier return has its own approval chain and team assignment
- **SUPP-03**: Supplier return links to originating customer RMAs where applicable

### Notifications

- **NOTF-01**: Customer receives email notification when RMA status changes
- **NOTF-02**: Returns Agent receives email notification when action is required on an RMA they own
- **NOTF-03**: Users can configure which notification events they receive

### Analytics

- **ANLX-01**: Admin can view return rate by product category and reason code
- **ANLX-02**: Admin can export RMA data for a date range to CSV

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile native app | Web-first; responsive design sufficient for v1 |
| Automated disposition decisions | Human judgment required; no training data yet |
| Real-time chat / WebSocket | Async communication threads sufficient; added complexity not justified |
| Bulk RMA import | Not a stated pain point; edge case volume |
| Repair/depot tracking | Separate workflow domain not applicable to distributor model |
| Multi-currency | Single currency environment for v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 — Foundation | Complete |
| FOUND-02 | Phase 1 — Foundation | Complete |
| FOUND-03 | Phase 1 — Foundation | Complete |
| FOUND-04 | Phase 1 — Foundation | Complete |
| FOUND-05 | Phase 1 — Foundation | Complete |
| LCYC-01 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-02 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-03 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-04 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-05 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-06 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-07 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-08 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-09 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-10 | Phase 2 — Core RMA Lifecycle | Complete |
| LCYC-11 | Phase 2 — Core RMA Lifecycle | Complete |
| LINE-01 | Phase 2 — Core RMA Lifecycle | Complete |
| LINE-02 | Phase 2 — Core RMA Lifecycle | Complete |
| LINE-03 | Phase 2 — Core RMA Lifecycle | Complete |
| LINE-04 | Phase 3 — Workflow and Line Operations | Pending |
| WKFL-01 | Phase 3 — Workflow and Line Operations | Pending |
| WKFL-02 | Phase 3 — Workflow and Line Operations | Pending |
| WKFL-03 | Phase 3 — Workflow and Line Operations | Pending |
| WKFL-04 | Phase 3 — Workflow and Line Operations | Pending |
| WKFL-05 | Phase 3 — Workflow and Line Operations | Pending |
| COMM-01 | Phase 4 — Communication and Attachments | Pending |
| COMM-02 | Phase 4 — Communication and Attachments | Pending |
| COMM-03 | Phase 4 — Communication and Attachments | Pending |
| COMM-04 | Phase 4 — Communication and Attachments | Pending |
| ATTC-01 | Phase 4 — Communication and Attachments | Pending |
| ATTC-02 | Phase 4 — Communication and Attachments | Pending |
| DASH-01 | Phase 5 — Workspace and Dashboards | Pending |
| DASH-02 | Phase 5 — Workspace and Dashboards | Pending |
| DASH-03 | Phase 5 — Workspace and Dashboards | Pending |
| DASH-04 | Phase 5 — Workspace and Dashboards | Pending |
| CUST-01 | Phase 6 — Customer Self-Service Portal | Pending |
| CUST-02 | Phase 6 — Customer Self-Service Portal | Pending |
| CUST-03 | Phase 6 — Customer Self-Service Portal | Pending |
| CUST-04 | Phase 6 — Customer Self-Service Portal | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation — phase names finalized*
