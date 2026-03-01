// ══════════════════════════════════════════════════════════════════════════════
// supplier.js — Page 2: Supplier Data Display
//
// Depends on (must be loaded first in HTML):
//   config.js    → NOROVISION_URL, SESSION_TIMEOUT_MS
//   mock-data.js → SUPPLIERS, getActiveOrderLines()
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // ── STEP 1: Session guard ─────────────────────────────────────────────────
  // If no supplier was selected on Page 1, redirect back immediately.
  const supplierId = sessionStorage.getItem('selectedSupplierId');
  if (!supplierId) {
    window.location.href = './index.html';
    return;
  }

  // ── STEP 2: Load and render batch data ───────────────────────────────────
  try {
    // Find supplier in mock data
    const supplier = SUPPLIERS.find(s => s.id === supplierId);
    if (!supplier) {
      throw new Error(`Supplier not found: ${supplierId}`);
    }

    // Merge admin-saved signed dates from localStorage.
    // localStorage (admin-entered) takes priority over mock data defaults.
    // DATA NOTE: In production this merge will not be needed — the API
    // will return the database-stored signed date directly.
    try {
      const savedDates = JSON.parse(localStorage.getItem('partnershipDates') || '{}');
      if (savedDates[supplierId]) {
        supplier.signedDate = savedDates[supplierId];
      }
    } catch {
      // localStorage read failure is non-fatal; use mock signedDate as fallback
    }

    // Render all four metric boxes + headline
    renderPage(supplier);

  } catch (err) {
    // Batch data load failed — show error modal, do not display partial data
    console.error('Failed to load supplier data:', err);
    showErrorModal();
    return; // Stop execution; do not start timer or real-time query
  }

  // ── STEP 3: Real-time active order lines query ────────────────────────────
  // Executes independently of batch data.
  // Failures are caught silently; the bar stays hidden.
  //
  // REAL-TIME NOTE: getActiveOrderLines() is mocked.
  // When the Phoenix DC endpoint is available, replace with:
  //   const response = await fetch(`/api/realtime/active-lines?supplierId=${supplierId}&dc=phoenix`);
  //   const data = await response.json();
  //   return data.activeLineCount;
  loadActiveOrderLines(supplierId);

  // ── STEP 4: Start inactivity timer ───────────────────────────────────────
  startInactivityTimer();

});

// ══════════════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Renders all page content for the given supplier.
 * Called once on DOMContentLoaded if data load succeeds.
 * @param {Object} supplier
 */
function renderPage(supplier) {
  renderHeadline(supplier);
  renderTopBranches(supplier.top5Branches);
  renderSkuCount(supplier.skuCount);
  renderSplitBars('region-split', [
    { label: 'Americas', value: supplier.regionSplit.americas },
    { label: 'EMEA',     value: supplier.regionSplit.emea     },
    { label: 'APAC',     value: supplier.regionSplit.apac     },
  ]);
  renderSplitBars('channel-split', [
    { label: 'Online',      value: supplier.channelSplit.online      },
    { label: 'Traditional', value: supplier.channelSplit.traditional },
  ]);
}

/**
 * Renders the partner headline at the top of the page.
 *
 * Display rules:
 *   - signedDate missing/null → "Valued Partner, [Name]"
 *   - < 1 year                → "Thank You, [Name], for 1 Year of Partnership!"
 *   - decimal >= 0.5          → round up
 *   - decimal < 0.5           → round down
 *
 * @param {Object} supplier
 */
function renderHeadline(supplier) {
  const el    = document.getElementById('supplier-headline');
  const years = calcPartnershipYears(supplier.signedDate);

  if (years === null) {
    el.textContent = `Valued Partner, ${supplier.name}`;
  } else {
    const yearLabel = years === 1 ? '1 Year' : `${years} Years`;
    el.textContent  = `Thank You, ${supplier.name}, for ${yearLabel} of Partnership!`;
  }

  // Fade in after content is set
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });
}

/**
 * Calculates whole years of partnership from a signed date string.
 *
 * Rounding rules (per spec):
 *   - signedDate is null/missing → return null (caller shows "Valued Partner")
 *   - rawYears < 1               → return 1
 *   - decimal part >= 0.5        → round up (Math.ceil)
 *   - decimal part < 0.5         → round down (Math.floor)
 *
 * @param {string|null} signedDateStr — ISO 8601 date string or null
 * @returns {number|null}
 */
function calcPartnershipYears(signedDateStr) {
  if (!signedDateStr) return null;

  const signed = new Date(signedDateStr);
  if (isNaN(signed.getTime())) return null; // Guard against malformed dates

  const now        = new Date();
  const msPerYear  = 365.25 * 24 * 60 * 60 * 1000;
  const rawYears   = (now - signed) / msPerYear;

  if (rawYears < 1) return 1;

  const decimal = rawYears - Math.floor(rawYears);
  return decimal >= 0.5 ? Math.ceil(rawYears) : Math.floor(rawYears);
}

/**
 * Renders the Top 5 Branches ranked list (Box 1).
 * No dollar values shown — ranked by revenue per spec.
 * @param {string[]} branches — ordered array, index 0 = rank 1
 */
function renderTopBranches(branches) {
  const list = document.getElementById('top-branches-list');
  list.innerHTML = '';

  branches.slice(0, 5).forEach((branch, idx) => {
    const li = document.createElement('li');
    li.className = 'branch-item';
    li.innerHTML = `
      <span class="branch-rank" aria-hidden="true">${idx + 1}</span>
      <span class="branch-name">${escapeHtml(branch)}</span>
    `;
    list.appendChild(li);
  });
}

/**
 * Renders the SKU count with locale formatting (Box 2).
 * @param {number} count
 */
function renderSkuCount(count) {
  document.getElementById('sku-count').textContent =
    count.toLocaleString('en-US');
}

/**
 * Renders percentage split bars (Boxes 3 & 4).
 * Percentage values are display-only — no dollar amounts shown.
 * Segments must sum to 100 (validated at data source).
 *
 * Bars animate from 0% → actual value via CSS transition on width.
 *
 * @param {string} containerId — DOM id of the container element
 * @param {{ label: string, value: number }[]} segments
 */
function renderSplitBars(containerId, segments) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  segments.forEach(seg => {
    const row = document.createElement('div');
    row.className = 'split-row';
    row.innerHTML = `
      <div class="split-row-header">
        <span class="split-row-label">${escapeHtml(seg.label)}</span>
        <span class="split-row-pct">${seg.value}%</span>
      </div>
      <div class="split-bar-track" role="progressbar"
           aria-valuenow="${seg.value}" aria-valuemin="0" aria-valuemax="100"
           aria-label="${escapeHtml(seg.label)} ${seg.value}%">
        <div class="split-bar-fill" data-target="${seg.value}"></div>
      </div>
    `;
    container.appendChild(row);
  });

  // Trigger bar animations after a brief delay so the CSS transition plays
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.querySelectorAll('.split-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// REAL-TIME ACTIVE ORDER LINES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Queries for active order lines in Phoenix DC (Packer Out status).
 * Shows the real-time bar only if count > 0.
 * On count === 0 or any error: bar stays completely hidden, no placeholder.
 *
 * @param {string} supplierId
 */
function loadActiveOrderLines(supplierId) {
  // Wrap in Promise.resolve() so the real fetch() replacement works without
  // changes to this calling code — just swap the function body of
  // getActiveOrderLines() in mock-data.js when the endpoint is ready.
  Promise.resolve(getActiveOrderLines(supplierId))
    .then(count => {
      if (count > 0) {
        document.getElementById('realtime-count').textContent =
          count.toLocaleString('en-US');
        document.getElementById('realtime-bar').classList.add('is-visible');
      }
      // count === 0: do nothing — bar remains hidden, spec requires no placeholder
    })
    .catch(err => {
      // Silent failure per spec: "Log the error internally. Do not show an
      // error message on the lobby screen."
      console.warn('Real-time order line query failed (bar will remain hidden):', err);
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Shows the "No data available" error modal.
 * Called when batch data cannot be retrieved.
 * No partial data state is displayed.
 */
function showErrorModal() {
  document.getElementById('error-modal').classList.add('is-visible');
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION INACTIVITY TIMER
// ══════════════════════════════════════════════════════════════════════════════

let inactivityHandle = null;

/**
 * Starts monitoring user activity.
 * After SESSION_TIMEOUT_MS of inactivity, redirects to the Norovision homepage.
 * This prevents the TV from remaining on a supplier page indefinitely.
 */
function startInactivityTimer() {
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
  resetInactivityTimer();
}

function resetInactivityTimer() {
  clearTimeout(inactivityHandle);
  inactivityHandle = setTimeout(() => {
    window.location.href = NOROVISION_URL;
  }, SESSION_TIMEOUT_MS);
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Escapes HTML special characters to prevent XSS when building innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, ch => map[ch]);
}
