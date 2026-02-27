# Project Research Summary

**Project:** Returns Management System (RMS) / RMA Portal — Master Electronics
**Domain:** B2B Electronics Distributor — Returns Authorization & Lifecycle Management
**Researched:** 2026-02-27
**Confidence:** MEDIUM-HIGH

## Executive Summary

A B2B Returns Management System for a mid-volume electronics distributor (500–2,000 RMAs/month) is a workflow-intensive, role-gated, compliance-adjacent system — not a simple CRUD application. Research confirms that this class of system is fundamentally organized around a formal state machine (Draft → Submitted → Approved → In Transit → Received → QC → Resolved → Closed, with branches for Info Required, Rejected, Contested, and Cancelled). The state machine is the foundation from which every other feature depends; building any role-gated or workflow feature before it is in place creates compounding technical debt that is expensive to unwind. The recommended approach is a layered build: database schema and state machine first, service layer second, REST API third, and React frontend last — with MERP integration isolated behind an adapter from day one.

The recommended technology stack (React 18 + NestJS 11 + PostgreSQL 16 + Prisma 7) is well-matched to the domain. NestJS's structured RBAC guard system, PostgreSQL's audit trigger support and JSONB indexing, and XState v5's explicit transition enforcement directly address the system's three highest-risk areas: role enforcement, audit compliance, and workflow correctness. Ant Design v5 with ProTable and ProForm covers the enterprise data-table and multi-step form requirements without requiring a custom design system. The frontend embeds into the existing Master Electronics host portal, inheriting auth via token injection — not iframe or cookie passthrough, both of which create security and compatibility problems.

The critical risks are concentrated in four areas that must be addressed at the foundation, not retrofitted: (1) allowing state transitions outside a single centralized state machine module creates impossible RMA states in production; (2) modeling RBAC as role-only without data-ownership scoping creates cross-customer data leakage via IDOR; (3) modeling line quantities as booleans rather than integers makes partial warehouse receipts untraceable; and (4) writing audit logs outside the same database transaction as state changes creates divergence between what happened and what was recorded. All four of these are "never acceptable" shortcuts with HIGH recovery cost — they must be designed correctly before any feature is built on top of them.

---

## Key Findings

### Recommended Stack

The stack is TypeScript end-to-end. NestJS 11 on the backend provides the guard system and modular architecture this project needs — plain Express would accumulate structural debt quickly at this complexity level. PostgreSQL 16 is the correct database choice over MySQL because of its superior audit trigger support, JSONB flexibility for audit payloads, and row-level security capability. Prisma 7 is the ORM of choice (over TypeORM, which has unresolved maintenance issues, and Drizzle, which is better suited to serverless environments). On the frontend, Ant Design v5 with ProComponents covers the heavy lifting of the RMA list view and multi-step submission form without a bespoke design system investment.

**Core technologies:**
- **React 18 + Vite 6:** Frontend framework and build tool — concurrent rendering, instant HMR, required by TanStack Query v5
- **NestJS 11:** Node.js API backend — structured RBAC guards, dependency injection, modular architecture; Fastify adapter available for performance headroom
- **PostgreSQL 16:** Primary database — JSONB audit payloads, ACID transitions, row-level security for RBAC at DB level
- **Prisma 7:** ORM — auto-generated type-safe client, declarative migrations, soft delete via partial indexes
- **Ant Design v5 (5.27.x) + ProComponents:** UI system — ProTable for RMA list view, ProForm/StepsForm for multi-step submission; do NOT use v6 (too new as of Q1 2026)
- **TanStack Query 5.90.x:** Server-state management — caching, background refetch, optimistic updates for approval actions; requires React 18
- **Zustand 5.x:** Client-state management — session context, filter panel state, bulk selection, wizard progress
- **XState 5.28.x:** Workflow state machine — enforces legal RMA lifecycle transitions on both frontend (UI state) and backend (authoritative)
- **React Hook Form 7.71.x + Zod 3.x:** Form validation — uncontrolled approach prevents re-render lag on multi-line forms; Zod schemas shareable between frontend and backend
- **BullMQ 5.70.x + Redis 7:** Background job queue — install now for v2 async MERP calls and notifications; structure the module to add without refactoring

**Critical version constraints:**
- TanStack Query v5 requires React 18+
- XState v5 requires TypeScript 5.0+
- Prisma 7 requires Node.js 18+; 20 LTS recommended for production
- Ant Design v5.27.x — do NOT upgrade to v6 (ProComponents ecosystem not yet updated)

### Expected Features

The full feature research is in `.planning/research/FEATURES.md`. Summary below.

**Must have (table stakes) — v1 launch:**
- RMA number generation — tracking is impossible without unique identifiers
- Full lifecycle state machine — core value of the system; everything depends on it
- Internal agent submission form — primary entry point at this volume
- Customer self-service submission portal — eliminates "create this for me" support calls
- Role-based access control (7 roles: Agent, Branch Manager, Warehouse, QC, Finance, Admin, Customer) — required before any other workflow feature is built
- Approval / rejection workflow — control point that makes the system authoritative
- Info Required state with communication thread — prevents hard-reject rework loops
- Multi-line RMA with line-level dispositions (Credit, Replacement, Scrap, RTV) — B2B returns are always multi-line
- Attachments per RMA and per line — required for QC and dispute resolution
- Search and filter — operational necessity at 500–2,000 RMAs/month
- Internal-only vs. customer-visible communication thread — non-negotiable for ops trust
- Audit log — compliance and dispute resolution baseline
- Basic dashboard / work queue by role, status, and age
- Warehouse receipt workflow — confirms physical return before QC
- QC inspection workflow — records outcome before disposition is finalized
- MERP integration stubs — unblocks v2 integration without blocking v1 launch
- Reason code taxonomy — structured codes enable future analytics; cheap to do right in v1

**Should have (differentiators) — v1.x after validation:**
- Contest / dispute flow — first-class workflow state not documented in any competitor product; genuine differentiator
- Aging alerts and SLA tracking — configure once actual cycle times are known from data
- Assignment / case ownership — add when queue management becomes a pain point
- Branch-level filtering and reporting — add when Branch Managers request their own view
- Finance visibility view and credit memo tracking — add when manual reconciliation effort is unsustainable
- Bulk / CSV import — add when high-volume consolidation returns start arriving

**Defer (v2+) — do not build in v1:**
- MERP live integration (credit memo and replacement order) — defer until API contracts are finalized
- Configurable approval thresholds — requires stable workflow data and Finance buy-in
- Return rate analytics — requires 6+ months of structured reason-code data
- Supplier return (RTV) full workflow — entirely different domain
- Email / SMS notifications — add when manual queue-checking is a demonstrated pain point
- Automated disposition rules — requires human-reviewed data to establish reliable patterns

**Anti-features (explicitly do not build):**
- Real-time push notifications in v1
- Mobile native app (responsive web covers the need)
- Warranty validation (hard integration dependency that blocks launch)
- Full ERP live integration in v1

### Architecture Approach

The system is a React SPA embedded inside the existing Master Electronics host portal, communicating with a NestJS REST API over HTTP, backed by PostgreSQL. The host portal injects auth context (JWT) into the RMS at mount time — the RMS never manages its own auth. All business logic lives in the NestJS service layer, with a dedicated workflow module (XState state machine) that is the only code path permitted to update the `status` column. Repositories abstract all database access; routes are thin HTTP wrappers over services. MERP integration is isolated behind an adapter interface from day one, with v1 shipping typed stubs and v2 replacing stub bodies with live HTTP calls at zero service-layer cost.

**Major components:**
1. **Host Portal** — provides auth token, navigation shell, user identity via window global injection
2. **RMS React SPA** — all RMA UI, routing within module, role-conditional rendering; reads token from host portal at mount
3. **TanStack Query layer** — server-state caching, optimistic updates, background refresh for all API interactions
4. **NestJS Routes/Controllers** — HTTP validation, auth/RBAC middleware, response shaping; zero business logic
5. **Service Layer** — all business logic: workflow transitions, validation rules, orchestration across repos
6. **XState Workflow Module** — single source of truth for legal RMA lifecycle transitions and role guards per transition
7. **Repository Layer** — SQL abstraction (one repo per aggregate root); services never write raw SQL
8. **Audit Log Repository** — append-only insert on every state/field change; written in same DB transaction as the state change
9. **MERP Adapter** — v1 stubs with typed request/response contract; v2 replaces stub body with live HTTP call
10. **PostgreSQL** — system of record; audit_events table partitioned by date from the start

**Key patterns to follow:**
- Feature-sliced directory structure on the frontend (one folder per domain slice under `features/`)
- RBAC enforced at both API middleware AND React rendering layer — never trust only the UI
- State machine instantiated per-transition (stateless); state persisted in DB, not in memory
- Audit writes in the same DB transaction as the state change that triggered them
- Attachment storage via S3-compatible presigned URLs; never proxy file bytes through the API server; never expose public bucket URLs

### Critical Pitfalls

The full pitfall research is in `.planning/research/PITFALLS.md`. Top findings:

1. **State machine not centralized** — Status written in multiple code paths produces impossible RMA states in production. Prevention: one `RMAStateMachine` module is the only code that may write to the `status` column. All API endpoints call `stateMachine.transition()`. Any direct `PATCH { status: "Approved" }` is rejected with 422. Recovery cost: HIGH.

2. **RBAC checks role but not data ownership** — A Returns Agent at Branch A can read, modify, or close Branch B's RMAs. Customers can enumerate other customers' RMAs by ID. Prevention: every RMA query includes both a role check AND an ownership filter (`branchId` or `customerId`). Never use sequential integer RMA IDs for external exposure. Recovery cost: HIGH.

3. **Audit log as afterthought** — Audit logging added post-hoc produces HTTP-level logs (`PATCH /rmas/1045`) with no field-level diffs. Finance and legal disputes have no defensible paper trail. Prevention: define `audit_events` schema (with `old_value`/`new_value` JSONB columns) before the first state transition is implemented. Write audit in the same DB transaction as the state change. Recovery cost: MEDIUM (backfill is impossible; historical gap is permanent).

4. **Multi-line quantity modeled as boolean** — `is_received: boolean` makes partial warehouse receipts untraceable. Prevention: model `received_qty: integer` and `disposition_qty: integer` from the start. Implement optimistic locking (`version` column) on line update endpoints. Recovery cost: MEDIUM (requires schema migration mid-project).

5. **ERP integration coupling at launch** — Synchronous MERP calls in the resolution flow mean MERP downtime blocks every RMA resolution. Building stubs without a negotiated contract means v2 integration is a full rewrite. Prevention: define `MERPAdapter` interface with typed request/response contract before writing stubs. V1 ships `MERPStubAdapter`; v2 ships `MERPLiveAdapter` behind the same interface. Log every outbound call in `merp_integration_log`. Recovery cost: MEDIUM.

6. **Portal embedding auth via cross-origin cookies** — Chrome third-party cookie deprecation breaks embedded cookie passthrough in production even when it works in local dev. Prevention: use postMessage token handoff OR shared-domain SameSite=Lax cookies; store JWT in React memory context, not localStorage. Test in staging with third-party cookie blocking enabled from day one. Recovery cost: MEDIUM.

7. **Internal notes visible to customers** — A missing `WHERE visibility = 'internal'` filter exposes dispute strategy and supplier info to customers. Prevention: enforce visibility filter at the data access layer in server-side query functions — never rely on the frontend to filter. Write automated test: log in as external customer, GET `/rmas/:id/comments`, assert zero internal records in response. Recovery cost: HIGH (immediate hotfix, customer notification, post-mortem).

---

## Implications for Roadmap

Research strongly suggests a 7-phase build order that respects the layered dependencies identified across all four research files. The state machine, RBAC, and audit log are not features — they are infrastructure that every feature depends on. Building workflow features before these are in place means rebuilding them when violations are discovered.

### Phase 1: Foundation and Data Model

**Rationale:** Every downstream component (service layer, API, frontend) depends on the database schema being correct. Schema mistakes are the most expensive to fix. The audit table, state enum, and line quantity model must be decided before any feature is built. MERP adapter interface must be defined before any disposition flow is built.

**Delivers:** PostgreSQL schema with migrations (rmas, rma_lines, dispositions, audit_events, users, roles, comments, attachments), NestJS project scaffold with auth middleware, RBAC middleware skeleton, repository layer with tests, MERP adapter interface with typed stubs and `merp_integration_log` table, Docker Compose environment for local dev.

**Addresses from FEATURES.md:** Audit log, reason code taxonomy, MERP integration stubs

**Avoids from PITFALLS.md:** Audit log as afterthought (Pitfall 5), multi-line quantity boolean trap (Pitfall 4), MERP coupling (Pitfall 2), MERP stub contract mismatch

**Research flag:** Standard patterns — well-documented NestJS + Prisma + PostgreSQL setup; no additional research phase needed.

---

### Phase 2: State Machine and Core Business Logic

**Rationale:** The XState state machine is the authoritative source for all workflow transitions. No status-changing feature can be correctly built until the machine is in place and tested. Service layer and audit service built here become the foundation for every API endpoint in Phase 3.

**Delivers:** XState RMA lifecycle machine (all states, transitions, guards, role permissions per transition), `rmaService.transitionRMA()` as the only code path that writes `status`, audit service with atomic DB writes, line service with integer quantity tracking, unit tests verifying every illegal transition returns an error.

**Addresses from FEATURES.md:** Full lifecycle state machine, approval/rejection workflow, info required state, cancellation, warehouse receipt, QC inspection

**Avoids from PITFALLS.md:** State machine not centralized (Pitfall 1), business logic in controllers (Architecture anti-pattern)

**Research flag:** Standard XState patterns — official docs are authoritative; no additional research phase needed.

---

### Phase 3: REST API Layer

**Rationale:** Routes are thin wrappers over the service layer built in Phase 2. They cannot be built until services exist. RBAC ownership scoping must be included in the initial query layer — not added later.

**Delivers:** NestJS controllers for RMAs, RMA lines, comments, attachments, and admin; Zod validation at controller boundary; RBAC middleware with role + data ownership filtering; error handling and response shaping; JWT validation from host portal auth context.

**Addresses from FEATURES.md:** Role-based access control (all 7 roles), search and filter endpoints, status transitions, attachment upload (presigned URL generation)

**Avoids from PITFALLS.md:** RBAC without data ownership (Pitfall 3), portal embedding auth breakage (Pitfall 6), attachment public bucket exposure

**Research flag:** Standard patterns — NestJS guard and Prisma query patterns are well-documented; no additional research phase needed.

---

### Phase 4: React Frontend Foundation

**Rationale:** The React frontend is a consumer of the API — it cannot be built until the API exists. Auth context, RBAC hooks, and routing structure are shared infrastructure that every feature view depends on.

**Delivers:** Vite + React 18 project scaffold, TanStack Query setup, Axios client with JWT token forwarding from host portal injection, auth context reading from host portal window global or props, RBAC hook (`useHasRole`, `useCanTransition`), ProtectedRoute, React Router structure (`/rmas`, `/rmas/:id`, `/rmas/new`), feature-sliced directory layout.

**Uses from STACK.md:** Vite 6, React 18, TanStack Query 5, Zustand 5, React Router 7, Ant Design 5, XState 5 (frontend actor for UI state)

**Avoids from PITFALLS.md:** Portal embedding auth breakage (Pitfall 6), auth token in localStorage (Security mistakes)

**Research flag:** Test the host portal token injection pattern in a staging environment with third-party cookie blocking enabled before proceeding to Phase 5. The exact integration mechanism (window global, props, postMessage) depends on the host portal team's preferred approach — confirm this early.

---

### Phase 5: Core RMA UI Features

**Rationale:** With the API and frontend foundation in place, this phase builds the primary user-facing surfaces that deliver the system's core value — the features that end the spreadsheet-and-email workflow.

**Delivers:** RMA list view with filtering/search (Ant Design ProTable), RMA detail view with header, lines, and status, RMA creation form multi-line (React Hook Form + Zod + StepsForm), transition action buttons with confirmation dialogs (approve, reject, info required, receive, QC, resolve, close), audit history timeline component, role-conditional UI rendering (hide/disable actions based on role and current state).

**Addresses from FEATURES.md:** Submission form (internal agent), customer self-service portal (initial), search and filter, basic dashboard / work queue, all core lifecycle states

**Uses from STACK.md:** Ant Design ProTable, ProForm, StepsForm, React Hook Form, Zod, TanStack Query optimistic updates

**Avoids from PITFALLS.md:** N+1 queries on RMA list (summary projections for list view, detail only on drill-down), re-rendering full list on status update (normalized React Query state)

**Research flag:** Multi-step form with line-item entry and validating only the current step before advancing is a moderately complex pattern — if the team is new to React Hook Form's multi-step approach, a focused research session is recommended before starting this phase.

---

### Phase 6: Communication, Attachments, and Supporting Features

**Rationale:** Comment threads and attachments are table stakes but depend on the core RMA model being stable. Communication thread visibility leakage is a HIGH-recovery-cost pitfall that must be built correctly the first time.

**Delivers:** Comment thread with internal vs. customer-visible distinction enforced at the query layer, attachment upload via presigned S3 URLs (direct client-to-S3 upload), attachment display with short-TTL presigned download URLs, post-upload malware scanning hook, visibility enforcement tests (automated test: external customer API returns zero internal notes).

**Addresses from FEATURES.md:** Communication thread, attachments, info required state communication mechanism

**Avoids from PITFALLS.md:** Internal note visibility leakage (Pitfall 7), attachment public bucket exposure (Security mistakes), storing attachments as DB BLOBs (Technical debt)

**Research flag:** The malware scanning pipeline (AWS GuardDuty for S3 or equivalent) may need a focused research session if the deployment target is on-premises (MinIO instead of AWS S3).

---

### Phase 7: v1.x Differentiators and MERP Live Integration

**Rationale:** These features add meaningful value but require stable workflow data and validated core functionality before they can be correctly configured. Contest/dispute flow requires confirmed rejection baseline; MERP live integration requires finalized API contracts.

**Delivers:** Contest / dispute flow (customer-initiated from Rejected state, Branch Manager review, documented resolution), aging alerts and SLA thresholds, assignment / case ownership, branch-level filtering and reporting, Finance visibility view, MERP live integration (`MERPLiveAdapter` replacing stub bodies, zero service-layer changes), bulk CSV import for multi-item submissions.

**Addresses from FEATURES.md:** Contest / dispute (key differentiator), aging alerts, assignment, branch reporting, Finance view, MERP integration live

**Avoids from PITFALLS.md:** MERP synchronous call blocking (async via BullMQ + Redis for live MERP calls), MERP idempotency (check for existing reference before re-calling)

**Research flag:** MERP live integration needs a dedicated research/design session once MERP API documentation is available. MERP's actual request/response schema, error codes, and idempotency behavior are unknown — this is the single largest unknown in the project. The stub adapter contract should be negotiated with the MERP team before v1 ships, not when v2 starts.

---

### Phase Ordering Rationale

- **Foundation before features:** The audit log, state machine, and line quantity model are discovered by pitfalls research as must-be-correct-from-day-one artifacts. Building any workflow feature before these are in place creates HIGH-cost rework.
- **Backend before frontend:** The React frontend is a pure consumer of the NestJS API. Building UI without API means building against assumptions that change when the real API arrives.
- **RBAC and ownership scoping in Phase 3, not later:** Data ownership scoping is a schema and query-layer concern. Retrofitting it after API endpoints are built requires touching every repository function.
- **Communication and attachments after core workflow:** These features depend on the RMA model being stable. Building them before Phase 5 means they'll need to be reworked when submission and transition flows are finalized.
- **MERP adapter interface in Phase 1, live integration in Phase 7:** This decouples RMS launch from MERP integration timeline — the single most important sequencing decision for launch risk management.
- **v1.x differentiators (contest, aging, branch reporting) after validation:** Research recommends configuring SLA thresholds and dispute flows after baseline data is available from production. Adding these before launch with invented thresholds creates noise.

### Research Flags

Phases likely needing deeper research or coordination during planning:

- **Phase 4 (Frontend Foundation):** Confirm host portal auth injection mechanism with the portal team before starting. The exact pattern (window global, props, postMessage) determines how `App.tsx` initializes and how Zustand is seeded. This is a team coordination dependency, not a technical research gap.
- **Phase 5 (Core RMA UI):** If team is unfamiliar with React Hook Form multi-step wizard pattern, a focused research session on StepsForm + per-step Zod schema validation is recommended before starting the submission form.
- **Phase 6 (Attachments):** If deployment target is on-premises, research MinIO setup and whether AWS GuardDuty equivalent scanning is available or needs a different approach.
- **Phase 7 (MERP Live Integration):** Full research session required once MERP API documentation is available. This is the highest-unknown integration in the project. Do not estimate Phase 7 timelines until the MERP API contract is in writing.

Phases with well-documented standard patterns (skip research-phase):

- **Phase 1 (Foundation):** NestJS + Prisma + PostgreSQL setup is thoroughly documented in official sources.
- **Phase 2 (State Machine):** XState v5 actor model is documented in official Stately docs; backend usage pattern is established.
- **Phase 3 (REST API):** NestJS guards, Prisma query patterns, and Zod controller validation are all well-documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified via npm and official sources; architectural choices verified across multiple sources; all recommended libraries are actively maintained |
| Features | MEDIUM | Web search verified across multiple competitor products and industry sources (Microsoft Dynamics, Oracle JD Edwards, ClaimLane); no single authoritative standard for B2B electronics RMA feature sets |
| Architecture | MEDIUM-HIGH | Patterns from well-established ERP/workflow domain; state machine, RBAC, and audit patterns are industry-standard; MERP-specific integration is LOW confidence since MERP is a custom ERP |
| Pitfalls | MEDIUM | Domain patterns cross-referenced against state machine, ERP integration, and portal embedding literature; pitfalls validated against real production failure modes documented in public post-mortems |

**Overall confidence: MEDIUM-HIGH**

### Gaps to Address

- **MERP API contract:** The single largest unknown. MERP's request/response schema, error codes, idempotency behavior, and authentication mechanism are completely undefined in the research. This must be negotiated with the MERP team before the Phase 1 stub interface is finalized and before any Phase 7 estimate is made.

- **Host portal auth injection mechanism:** The exact pattern the host portal uses to expose auth context (window global, React props, postMessage, shared cookie) determines Phase 4 implementation details. Confirm with the portal team during Phase 1.

- **Deployment environment for attachments:** Research assumes S3-compatible object storage (AWS S3 or MinIO). If deployment is fully on-premises with no object storage available, attachment strategy needs reconsideration.

- **Return rate analytics data baseline:** Analytics features (v2+) require 6+ months of structured reason-code data. Do not plan analytics in v1 or v1.x. Revisit after the system has been in production for two quarters.

- **Configurable approval thresholds:** The value thresholds for automatic vs. manager-required approval are a business configuration decision (what dollar amount triggers Branch Manager sign-off?). This needs input from operations before Phase 7.

---

## Sources

### Primary (HIGH confidence)
- [NestJS official docs](https://docs.nestjs.com/) — RBAC guards, JWT, modular architecture
- [XState official docs](https://stately.ai/docs/xstate) — actor model, v5 state machine patterns
- [TanStack Query v5 announcement](https://tanstack.com/blog/announcing-tanstack-query-v5) — React 18 requirement, API surface
- [Microsoft Learn — Process a return (Dynamics 365)](https://learn.microsoft.com/en-us/dynamics365/field-service/process-return) — RMA domain model validation
- [Oracle — Understanding RMA (JD Edwards)](https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoaso/understanding-rma.html) — disposition types, line-level modeling

### Secondary (MEDIUM confidence)
- [Makersden: React state management 2025](https://makersden.io/blog/react-state-management-in-2025) — TanStack Query + Zustand pattern
- [Better Stack: Drizzle vs Prisma](https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/) — ORM comparison
- [Bytebase: PostgreSQL audit logging](https://www.bytebase.com/blog/postgres-audit-logging/) — audit trigger pattern
- [Bulletproof Node.js Project Architecture](https://softwareontheroad.com/ideal-nodejs-project-structure) — service/repository separation
- [ClaimLane — Return Management System Guide](https://www.claimlane.com/return-management-system) — domain feature landscape
- [Pathlock: RBAC Pitfalls](https://pathlock.com/blog/role-based-access-control-rbac/) — role explosion, data scoping gaps
- [Mistakes Made When Adopting Event Sourcing — Anes Hasicic](https://aneshas.medium.com/mistakes-made-when-adopting-event-sourcing-and-how-we-recovered-ddd-eu-2020-talk-summary-7e25f1eb890a) — audit log design, transaction atomicity

### Tertiary (LOW confidence — used for domain validation only)
- RMAPortal, ReverseLogix, RenewityRMA — vendor marketing; used for competitor feature comparison
- SAP Advanced Returns Management — different stack; used for domain model validation only

---

*Research completed: 2026-02-27*
*Ready for roadmap: yes*
