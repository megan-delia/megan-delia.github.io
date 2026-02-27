# Phase 1: Foundation - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Project scaffold, database schema, portal authentication middleware, RBAC with data-ownership scoping, audit log infrastructure, and typed MERP adapter stubs. This phase delivers no user-facing features — it delivers the infrastructure every subsequent phase depends on. The RMA state machine and all feature work begin in Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Role Sourcing
- Roles are RMS-managed: the host portal provides user identity (who you are), but RMS stores its own role-to-user assignments in its own database table
- The RMS does NOT read roles from the portal's JWT — it uses the portal's user ID as a foreign key to look up RMS role assignments
- Only System Admin can assign, change, or revoke RMS role assignments
- A single user can be assigned to multiple branches with a role in each (e.g., a regional manager covering 3 branches)
- Users who authenticate via the portal but have no RMS role assignment receive a 403 — no default access, no read-only fallback
- This means an Admin-facing user provisioning workflow is needed (list of users from portal, role assignment UI) — this is infrastructure that Phase 1 must include in the schema even if the full UI ships later

### RBAC Model
- Data-ownership scoping is enforced at the query layer (not just middleware): all RMA queries are automatically filtered by the user's assigned branch(es)
- Admin role has global visibility across all branches — no branch filter applied
- Finance and QC roles: their branch scoping follows the same multi-branch model (if Finance is assigned to 2 branches, they see RMAs from both)

### Claude's Discretion
- Auth handoff mechanism (cookie vs. Authorization header vs. postMessage) — confirm with portal team; Claude selects the technically appropriate pattern given traditional web app host
- Audit log event granularity — Claude defines the initial event taxonomy; can be expanded in later phases
- MERP adapter stub contract shapes — Claude defines the typed interfaces based on standard credit memo and replacement order data models for electronics distribution
- Schema migration tooling and PostgreSQL configuration details

</decisions>

<specifics>
## Specific Ideas

- No specific UI references for Phase 1 — this is a backend/infrastructure phase
- The user provisioning model (Admin assigns roles) implies the schema needs a `user_branch_roles` or equivalent junction table from day one, even if the admin UI to manage it ships later

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-02-27*
