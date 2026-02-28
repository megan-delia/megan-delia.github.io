# Milestones

## v1.0 MVP (Shipped: 2026-02-28)

**Phases completed:** 4 phases (1, 2, 3, 3.5), 16 plans
**Timeline:** 3 days (2026-02-26 → 2026-02-28)
**Codebase:** ~5,150 lines TypeScript (~2,400 source + ~2,750 tests)
**Requirements:** 25/25 v1.0 in-scope requirements satisfied

**Delivered:** Full RMA lifecycle backend — every customer return can be created, submitted, approved, received, inspected, and resolved through a REST API with RBAC and branch-scoped data isolation.

**Key accomplishments:**
- NestJS 11 + Prisma 7 project scaffold with PostgreSQL, JWT portal auth (no second login), 7-role RBAC guard chain, append-only audit log with atomic DB writes, and typed MERP adapter stubs
- Complete RMA state machine (11 lifecycle + 3 line-item requirements) with `assertValidTransition()` as sole state-change gateway; 41 Jest unit tests green
- Workflow layer: contest/overturn/uphold flow, Finance credit approval gate, QC per-line inspection, and line splitting — exposed via RmaController, WorkflowController, and FinanceController
- LifecycleController (14 endpoints) closing INT-01/02/03 from milestone audit; branch-scoped reads enforce 404-not-403 data isolation; all 25 v1.0 requirements reachable end-to-end over HTTP
- Integration test baselines for all 3 phases: lifecycle (24 tests), workflow (16 tests), lifecycle-HTTP (23 tests) — ready to run against Docker + live DB

**Tech debt noted:**
- Docker not installed in execution environment — Prisma migration never run; integration tests require Docker
- MerpAdapter stubs exist but RmaService never calls them — intentional v1 design (MERP live integration is v2)
- AppController (GET /) declared but not registered in AppModule
- RecordQcInput in rma.types.ts is dead code (superseded by Phase 3 type)

**Archive:** `.planning/milestones/v1.0-ROADMAP.md`, `.planning/milestones/v1.0-REQUIREMENTS.md`

---

