// ══════════════════════════════════════════════════════════════════════════════
// config.js — Global constants for the Supplier Interactive Display
// ══════════════════════════════════════════════════════════════════════════════

// ── NOROVISION INTEGRATION ────────────────────────────────────────────────────
// [REPLACE] Update this URL to the real Norovision Timeline homepage endpoint
// when it becomes available. This is used for:
//   1. The "Return to Norovision" button on Page 1
//   2. The 5-minute inactivity session timeout redirect on both pages
// SECURITY NOTE: Access restriction to the Master Electronics internal network
// cannot be enforced by a static GitHub Pages site. Production deployment
// requires an Nginx reverse proxy or firewall rules restricting access to the
// corporate LAN/VPN.
const NOROVISION_URL = 'https://placeholder.norovision.internal/';

// ── SESSION TIMEOUT ───────────────────────────────────────────────────────────
// Time (in milliseconds) of user inactivity before automatically redirecting
// to the Norovision homepage. Default: 300000 = 5 minutes.
// To test timeout behavior, temporarily set to 5000 (5 seconds), then restore.
const SESSION_TIMEOUT_MS = 300000;
