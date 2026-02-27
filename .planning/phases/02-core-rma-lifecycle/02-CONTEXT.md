# Phase 2: Core RMA Lifecycle - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the authoritative state machine and service layer for all RMA lifecycle transitions, line items with integer quantity tracking, and audit writes in the same DB transaction. No REST API in this phase — Phase 3 builds that on top. This phase is the only code path that writes RMA status.

</domain>

<decisions>
## Implementation Decisions

### Invalid Transition Behavior
- Rejection reason is **required** (same policy as cancellation per LCYC-11) — Branch Manager cannot reject without a documented reason
- Error shape, whether to enumerate valid transitions in the error response, and enforcement layer (service vs DB constraint) are Claude's discretion

### Partial Receipt & RMA State
- RMA transitions to **Received immediately on first receipt entry** — any warehouse log on any line triggers the transition
- Warehouse can **continue updating received quantities** while the RMA is in Received status (e.g., goods arrive over multiple days); receipt is not locked on first transition
- **Over-receipt is allowed** — received quantity may exceed the ordered quantity per line (over-shipment happens; just track it)
- **QC-inspected quantity is capped at received quantity** per line — service rejects any entry that would push inspected qty above received qty

### Info Required Response Mechanism
- **Line items are fully editable while in Info Required** — the submitter (agent or customer) can update quantities, reason codes, and dispositions before responding
- **No cycle limit** — an RMA can move through Info Required → Submitted → Info Required indefinitely; audit trail captures every cycle
- **Info Required is cancellable** — a Returns Agent can cancel an RMA in Info Required status (extends LCYC-11 coverage beyond Draft/Submitted/Approved)
- The exact mechanism that triggers the transition back to Submitted (dedicated action vs. note) is Claude's discretion

### Disposition Assignment Timing
- Disposition (credit / replacement / scrap / RTV) can be set **at Draft creation and updated at any point until QC inspection** — not locked at submission
- Disposition is **optional at submission** — a line may be submitted with no disposition set; Finance and QC will determine it
- **Locked after QC inspection** — once QC records inspection on a line, its disposition is frozen; only an Admin can override in exceptional cases
- **Lines are fully editable in Draft and Info Required** (add, edit, remove); submitting the RMA locks the line set from that point forward

### Claude's Discretion
- Invalid transition error shape and whether to enumerate allowed transitions in the error response
- Whether to add a DB-layer constraint in addition to service-layer enforcement
- The specific action/mechanism that triggers resubmission from Info Required (dedicated endpoint vs. implicit on any update)
- RMA number generation format

</decisions>

<specifics>
## Specific Ideas

- No specific references or "make it like X" requirements — open to standard NestJS service + state machine patterns

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-core-rma-lifecycle*
*Context gathered: 2026-02-27*
