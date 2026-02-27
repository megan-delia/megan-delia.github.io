# Returns Management System (RMS)

## What This Is

A portal-native web application for Master Electronics that centralizes end-to-end management of customer RMAs and supplier returns. It embeds into the existing Master Electronics web portal and serves both internal staff (Returns Agents, Warehouse, QC, Finance, Branch Managers, Admins) and external customers who can submit and track their own returns. Built on React + Node.js with REST API integration to MERP (Master Electronics ERP).

## Core Value

Every return moves faster — from submission to resolution — because every person involved can see exactly where it is and what's blocking it.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Central returns workspace with filtering and search (by status, customer, supplier, facility, date range)
- [ ] Customer RMA lifecycle: Draft → Submitted → Approved → In Transit → Received → QC → Resolved → Closed, plus rejection, cancellation, Info Required, and contest flows
- [ ] Supplier return/claim lifecycle with its own separate status model and approval chain
- [ ] Multi-line RMAs with line-level dispositions (credit, replacement, scrap, RTV), line splitting, and quantity tracking
- [ ] Role-based access control: Returns Agent, Branch Manager, Warehouse, QC, Finance, Admin (+ external customer self-service)
- [ ] Approval workflows with contest flows and Info Required state
- [ ] Audit logging for all key actions (actor, timestamp, action, old/new values)
- [ ] Communication threads with internal-only vs. customer-visible separation
- [ ] Attachment/document repository per return
- [ ] MERP integration stubs for credit memos and replacement orders
- [ ] Dashboards for return status, aging, and exceptions

### Out of Scope

- Mobile native app — web-first, responsive later if needed
- Supplier return v1 full implementation — customer RMAs are MVP focus; supplier returns are v2
- Real-time notifications (email/SMS) — deferred; manual workflow for v1
- Automated disposition decisions — human-driven for v1

## Context

- **Current state:** Multiple disconnected tools — teams using a mix of email, spreadsheets, and ad-hoc systems. No single source of truth for return status.
- **Volume:** 500–2,000 RMAs/month — high enough that efficiency matters and manual tracking breaks down.
- **Existing portal:** Master Electronics has an existing traditional web app (server-rendered) that this RMS embeds into as a module. The RMS itself is built as a React + Node.js application.
- **MERP:** Master Electronics' custom internal ERP. The RMS integrates via REST API — primarily for credit memo and replacement order creation (stubs in v1, full integration in v2).
- **Submitters:** Both internal staff entering RMAs on behalf of customers AND external customers logging in and submitting their own returns through the portal.
- **Supplier returns:** Treated as a separate domain from customer RMAs — different workflows, teams, and approval chains. Not in MVP scope.

## Constraints

- **Tech Stack:** React frontend, Node.js API backend — chosen to match modern JS ecosystem and enable fast iteration
- **Portal Integration:** Must embed into the existing Master Electronics web portal; authentication and navigation from host portal
- **MERP API:** Integration is REST-based; v1 ships stubs (structure + contract) rather than live calls — avoids ERP dependency blocking RMS launch
- **MVP Scope:** Core customer RMA lifecycle must work end-to-end before shipping; other features phase in after

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Customer RMAs before supplier returns | Supplier returns are "very different" — separate workflows, teams, approval chains. Trying to build both at once risks neither being good. | — Pending |
| MERP integration stubs in v1 | Decouples RMS launch from ERP integration work; teams can use RMS immediately while MERP API contracts are finalized | — Pending |
| React + Node.js stack | New build, modern JS ecosystem, doesn't need to match existing traditional portal's server-rendered stack | — Pending |
| Portal-native embedding | RMS lives inside the existing portal for auth/nav continuity; not a standalone app requiring separate login | — Pending |

---
*Last updated: 2026-02-27 after initialization*
