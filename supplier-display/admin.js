// ══════════════════════════════════════════════════════════════════════════════
// admin.js — Partnership Dates Admin Page
//
// Reads/writes partnership signed dates to localStorage.
// Key: 'partnershipDates'  Value: JSON object { [supplierId]: 'YYYY-MM-DD' }
//
// DATA NOTE: localStorage is prototype-only (per-browser, per-machine).
// Production requires a database-backed API endpoint.
// localStorage is cleared when the user clears browser storage.
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  const tbody      = document.getElementById('admin-table-body');
  const saveBtn    = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const searchInput = document.getElementById('admin-search');
  const countEl    = document.getElementById('admin-count');

  // ── Load existing saved dates from localStorage ──────────────────────────
  const savedDates = loadSavedDates();

  // ── Render all supplier rows ─────────────────────────────────────────────
  const suppliers = getEligibleSuppliers();
  renderRows(suppliers, savedDates);
  updateCount();

  // ── Search/filter ────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    const rows  = tbody.querySelectorAll('tr[data-supplier-id]');
    let visible = 0;

    rows.forEach(row => {
      const name = row.dataset.supplierName.toLowerCase();
      const matches = name.includes(query);
      row.style.display = matches ? '' : 'none';
      if (matches) visible++;
    });

    updateCount(visible);
  });

  // ── Live status badge update as date inputs change ───────────────────────
  tbody.addEventListener('change', (e) => {
    if (!e.target.classList.contains('admin-date-input')) return;
    const statusCell = e.target.closest('tr').querySelector('.status-cell');
    statusCell.innerHTML = buildStatusBadge(e.target.value);
  });

  // ── Save All button ──────────────────────────────────────────────────────
  saveBtn.addEventListener('click', () => {
    const dates = {};
    tbody.querySelectorAll('.admin-date-input').forEach(input => {
      if (input.value) {
        dates[input.dataset.supplierId] = input.value;
      }
    });

    try {
      localStorage.setItem('partnershipDates', JSON.stringify(dates));
      flashSaveStatus();
    } catch (err) {
      // localStorage may be unavailable (private browsing, storage full, etc.)
      console.error('Failed to save to localStorage:', err);
      alert('Could not save: browser storage may be unavailable or full.');
    }
  });

  // ── HELPERS ──────────────────────────────────────────────────────────────

  /**
   * Reads saved dates from localStorage.
   * Returns an empty object if nothing is saved or data is malformed.
   */
  function loadSavedDates() {
    try {
      const raw = localStorage.getItem('partnershipDates');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  /**
   * Renders one table row per supplier.
   * Merges localStorage dates with mock data default signedDates.
   * localStorage takes priority (it represents admin-entered values).
   */
  function renderRows(suppliers, savedDates) {
    tbody.innerHTML = '';
    suppliers.forEach(supplier => {
      // Precedence: localStorage > mock signedDate > empty
      const dateValue = savedDates[supplier.id] || supplier.signedDate || '';

      const tr = document.createElement('tr');
      tr.dataset.supplierId   = supplier.id;
      tr.dataset.supplierName = supplier.name;

      tr.innerHTML = `
        <td class="supplier-name-cell">${escapeHtml(supplier.name)}</td>
        <td class="supplier-id-cell">${escapeHtml(supplier.id)}</td>
        <td>
          <input
            type="date"
            class="admin-date-input"
            value="${escapeHtml(dateValue)}"
            data-supplier-id="${escapeHtml(supplier.id)}"
            aria-label="Partnership signed date for ${escapeHtml(supplier.name)}"
          >
        </td>
        <td class="status-cell">${buildStatusBadge(dateValue)}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  /**
   * Returns HTML for a status badge.
   * @param {string} dateValue — ISO date string or empty string
   */
  function buildStatusBadge(dateValue) {
    if (dateValue) {
      return `<span class="status-badge status-signed">✓ Signed</span>`;
    }
    return `<span class="status-badge status-unsigned">Not set</span>`;
  }

  /**
   * Updates the supplier count hint in the toolbar.
   * @param {number|undefined} visibleCount — pass undefined to count all rows
   */
  function updateCount(visibleCount) {
    const total = getEligibleSuppliers().length;
    const shown = (visibleCount !== undefined) ? visibleCount : total;
    countEl.textContent = shown === total
      ? `${total} suppliers`
      : `${shown} of ${total} suppliers`;
  }

  /**
   * Shows the "Saved successfully" status message for 3 seconds.
   */
  function flashSaveStatus() {
    saveStatus.classList.add('is-visible');
    setTimeout(() => saveStatus.classList.remove('is-visible'), 3000);
  }

  /**
   * Escapes HTML special characters to prevent XSS when building innerHTML.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, ch => map[ch]);
  }

});
