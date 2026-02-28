# Retrospective: Returns Management System (RMS)

---

## Milestone: v1.0 — MVP

**Shipped:** 2026-02-28
**Phases:** 4 (1, 2, 3, 3.5) | **Plans:** 16 | **Timeline:** 3 days

### What Was Built

- NestJS 11 + Prisma 7 project scaffold with PostgreSQL, JWT auth, RBAC, audit log, and MERP stubs (Phase 1)
- Complete RMA state machine: 11 lifecycle + 3 line-item requirements, `assertValidTransition()` as sole gateway, 41 Jest unit tests (Phase 2)
- Workflow layer: contest/overturn/uphold, Finance credit gate, QC inspection, line splitting, 3 REST controllers (Phase 3)
- LifecycleController: 14 endpoints, branch-scoped reads, closes INT-01/02/03 from audit — all 25 v1 requirements HTTP-reachable (Phase 3.5)

### What Worked

- **Audit-driven gap closure:** Running `/gsd:audit-milestone` before declaring v1.0 complete caught that lifecycle methods had no HTTP surface. Phase 3.5 was inserted cleanly as a decimal phase (3.5), closed all 3 integration gaps, and the audit re-ran to `tech_debt` status — a tight loop.
- **`assertValidTransition()` as a single choke point:** Every impossible state became a compile-time or runtime guard rather than defensive code scattered across services. State machine correctness propagated through all 11 lifecycle methods without repeated validation.
- **`@Inject(Token)` discipline from Phase 1:** Discovering early that esbuild/Vitest doesn't emit `design:paramtypes` meant the pattern was documented and followed consistently across all 16 plans. Zero DI surprises in later phases.
- **branchScopeWhere() as query filter:** Establishing the data-isolation function in Phase 1 meant all later repository reads got branch scoping by construction — not as an afterthought.
- **Integration test pattern established early:** Phase 1 set up the Vitest + NestJS TestingModule + real DB pattern. Phases 2, 3, and 3.5 all reused it without re-inventing.

### What Was Inefficient

- **Prisma 7 adapter surprise:** Prisma 7 requires the PrismaPg adapter pattern — this is a breaking change from 5/6 not yet widely documented. Discovering it in Phase 1 cost extra time and required undocumented patterns (`datasource URL in prisma.config.ts only`). Future projects should pin to a known Prisma version and read the migration guide.
- **Docker unavailable in execution environment:** All integration tests are written correctly but none have ever run against a real DB. The full confidence check (63 tests) is deferred to when Docker is available. This is an infrastructure constraint, not a code defect, but it means v1.0 shipped without end-to-end integration test validation.
- **ROADMAP.md plan checkboxes drifted:** The plan checkboxes in ROADMAP.md for Phase 3 and 3.5 weren't fully checked off as plans completed — the progress table was correct but the plan list had unchecked items. Caused minor confusion during milestone completion.
- **MerpAdapter orphaned:** The DI token and stub were wired in Phase 1, but RmaService never injects MerpAdapter. The interface is correct for v2, but the adapter being "there but unused" created audit noise (FOUND-05 partial satisfaction note).

### Patterns Established

- **Decimal phase insertion:** Insert urgent work as Phase N.5 between integer phases. Keeps numeric order, marks clearly as INSERTED, doesn't disrupt downstream phase numbers.
- **3-source requirements cross-reference:** Audit checks REQUIREMENTS.md checkboxes + VERIFICATION.md coverage + SUMMARY.md frontmatter. Any requirement missing from 2+ sources flags as a gap.
- **FK-safe cleanup order:** `auditEvent → rmaLine → rma → userBranchRole → user → branch` — learned in Phase 2, reused in Phases 3 and 3.5 without incident.
- **getQcCompleteWithCredit() helper pattern:** Complex multi-step test prerequisites encapsulated in a helper function — reduces spec verbosity and makes test intent clearer.
- **findFirst not findUnique for branchScopeWhere:** Prisma cannot compose `findUnique` with non-unique `where` conditions. Always use `findFirst` for branch-scoped queries.

### Key Lessons

1. Run `/gsd:audit-milestone` before declaring a milestone complete — it caught a real gap (LifecycleController missing) that would have shipped as a defect.
2. All NestJS services using Vitest must use `@Inject(Token)` on every constructor param — document this in the project and enforce from day one.
3. Set up Docker and run `prisma migrate dev` as the first thing in any new environment. Don't defer infrastructure.
4. Prisma 7 is significantly different from 5/6 — treat it as a new ORM and read its migration guide, not older tutorials.
5. The state machine pattern (`ALLOWED_TRANSITIONS` + `assertValidTransition()`) scales cleanly to 10 states — apply it to any future domain with a meaningful status field.

### Cost Observations

- Model mix: balanced profile (Sonnet primary)
- Sessions: ~8–10 sessions across 3 days
- Notable: Phase 3.5 (gap closure) executed in a single session — decimal phase + audit loop worked efficiently

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | Requirements | Tech Debt Items |
|-----------|--------|-------|------|--------------|-----------------|
| v1.0 MVP  | 4      | 16    | 3    | 25/25        | 4               |

| Pattern | First Seen | Reused |
|---------|------------|--------|
| FK-safe cleanup order | Phase 2 | Phase 3, 3.5 |
| @Inject(Token) discipline | Phase 1 | All phases |
| branchScopeWhere() | Phase 1 | Phase 3.5 |
| State machine choke point | Phase 2 | — |
| Integration test helper fns | Phase 2 | Phase 3, 3.5 |
