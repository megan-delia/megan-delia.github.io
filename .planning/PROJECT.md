# Returns Management System (RMS)

## What This Is

A portal-native web application for Master Electronics that centralizes end-to-end management of customer RMAs. It embeds into the existing Master Electronics web portal and serves both internal staff (Returns Agents, Warehouse, QC, Finance, Branch Managers, Admins) and external customers who can submit and track their own returns. Built on React + Node.js (NestJS) with REST API integration to MERP.

The v1.0 backend is complete: the full RMA lifecycle runs end-to-end over a 22-endpoint REST API with RBAC guards, branch-scoped data isolation, and atomic audit logging on every state change.

## Core Value

Every return moves faster — from submission to resolution — because every person involved can see exactly where it is and what's blocking it.

## Requirements

### Validated

- ✓ JWT portal auth (no second login) — v1.0 (FOUND-01)
- ✓ RBAC for 7 roles: Returns Agent, Branch Manager, Warehouse, QC, Finance, Admin, Customer — v1.0 (FOUND-02)
- ✓ Branch-scoped data ownership (404-not-403 isolation) — v1.0 (FOUND-03)
- ✓ Atomic append-only audit log on every state change — v1.0 (FOUND-04)
- ✓ Typed MERP adapter stubs (credit memo + replacement order contracts) — v1.0 (FOUND-05)
- ✓ Full RMA lifecycle: Draft → Submitted → Approved → Received → QC → Resolved → Closed — v1.0 (LCYC-01 through LCYC-11)
- ✓ Line items with part number, quantity, reason code, disposition type, receivedQty, inspectedQty — v1.0 (LINE-01 through LINE-03)
- ✓ Line splitting — v1.0 (LINE-04)
- ✓ Approvals queue, contest/overturn/uphold flow, Finance credit gate, QC per-line inspection — v1.0 (WKFL-01 through WKFL-05)

### Active

- [ ] Internal notes visible to staff only; customer-visible messages visible to both (COMM-01, COMM-02, COMM-03, COMM-04)
- [ ] Document/photo attachments (PDF, JPG, PNG) per RMA with upload and download (ATTC-01, ATTC-02)
- [ ] Returns workspace with filter by status, customer, facility, date range; search by RMA#, customer, part (DASH-01, DASH-02)
- [ ] Manager dashboard: return volume by status, average time in each state, exceptions view (DASH-03, DASH-04)
- [ ] Customer self-service portal: submit, track, view detail, reply to messages (CUST-01 through CUST-04)

### Out of Scope

- Mobile native app — web-first; responsive design sufficient
- Automated disposition decisions — human judgment required; no training data
- Real-time notifications (email/SMS) — async threads sufficient for v1
- Bulk RMA import — not a stated pain point
- Repair/depot tracking — separate domain
- Multi-currency — single currency environment
- Supplier return v1 full implementation — customer RMAs are MVP; supplier returns are v2 (different workflows, teams, approval chains)

## Context

- **v1.0 shipped 2026-02-28:** 4 phases (1, 2, 3, 3.5), 16 plans, ~5,150 lines TypeScript. Backend-complete: 22 REST endpoints, full lifecycle, all 25 v1 requirements satisfied.
- **Tech stack:** NestJS 11 (backend), Prisma 7 + PostgreSQL, React (frontend — v1.1+), Jest + Vitest (testing)
- **Integration test status:** 63 tests written and ready (24 lifecycle + 16 workflow + 23 lifecycle-HTTP); require Docker + `prisma migrate dev` to execute
- **Volume target:** 500–2,000 RMAs/month
- **Existing portal:** Master Electronics traditional web app (server-rendered); RMS embeds as a React + Node.js module
- **MERP:** Custom internal ERP; v1 ships stubs, v2 activates live credit memo and replacement order creation
- **Known tech debt:** Docker not run in execution env (migration pending), MerpAdapter not invoked by RmaService (v2 scope), AppController not in AppModule, RecordQcInput dead code

## Constraints

- **Tech Stack:** React frontend, Node.js (NestJS) API backend — modern JS ecosystem, structured RBAC guards
- **Portal Integration:** Must embed into Master Electronics portal; auth and nav from host portal
- **MERP API:** REST-based; v1 stubs (structure + contract), live calls in v2 — decouples RMS launch from ERP timeline
- **MVP Scope:** Customer RMA lifecycle end-to-end before shipping; supplier returns, notifications, advanced analytics phase in after

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Customer RMAs before supplier returns | Supplier returns are "very different" — separate workflows, teams, approval chains. Building both at once risks neither being good. | ✓ Good — v1.0 complete with clean customer RMA scope |
| MERP integration stubs in v1 | Decouples RMS launch from ERP integration work; teams can use RMS while MERP API contracts are finalized | ✓ Good — stubs compile and DI-wire; v2 activates live calls |
| React + Node.js (NestJS) stack | New build, modern JS ecosystem, structured DI for RBAC guards | ✓ Good — NestJS guard chain worked cleanly for RBAC |
| Portal-native embedding | RMS lives inside existing portal for auth/nav continuity; not a standalone app | — Pending (frontend not yet built; JWT mechanism unconfirmed with portal team) |
| Prisma 7 adapter pattern | Prisma 7 breaking change from 5/6 — requires PrismaPg adapter and datasource URL in prisma.config.ts | ✓ Good — documented and working |
| @Inject(Token) on all DI params | esbuild (Vitest) doesn't emit design:paramtypes — all NestJS constructor injections require explicit @Inject | ✓ Good — pattern established, must continue in all new services |
| `assertValidTransition()` as sole gateway | Single choke point for all state changes — impossible states unreachable by construction | ✓ Good — all 10 RmaStatus keys covered, compile-time completeness enforced |
| branchScopeWhere() as query filter | All repository reads go through ownership filter — branch isolation by construction | ✓ Good — findFirst (not findUnique) required for WHERE clause composition |
| Phase 3.5 inserted as gap closure | Milestone audit found LifecycleController missing — decimal phase insertion cleanly closed INT-01/02/03 | ✓ Good — demonstrates audit-driven gap closure workflow |

---
*Last updated: 2026-02-28 after v1.0 milestone*
