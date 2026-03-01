// ══════════════════════════════════════════════════════════════════════════════
// selection.js — Page 1: Supplier Selection
//
// Depends on (must be loaded first in HTML):
//   config.js    → NOROVISION_URL, SESSION_TIMEOUT_MS
//   mock-data.js → getEligibleSuppliers()
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // ── Element references ────────────────────────────────────────────────────
  const norovisionBtn    = document.getElementById('norovision-btn');
  const searchInput      = document.getElementById('supplier-search');
  const dropdownList     = document.getElementById('supplier-list');
  const countHint        = document.getElementById('supplier-count-hint');
  const confirmModal     = document.getElementById('confirm-modal');
  const confirmNameEl    = document.getElementById('confirm-supplier-name');
  const confirmBtn       = document.getElementById('modal-confirm');
  const cancelBtn        = document.getElementById('modal-cancel');

  // ── State ─────────────────────────────────────────────────────────────────
  const allSuppliers       = getEligibleSuppliers();
  let   pendingSupplier    = null;   // supplier object awaiting confirmation
  let   highlightedIndex   = -1;    // keyboard nav index among visible items
  let   inactivityHandle   = null;

  // ── Init ──────────────────────────────────────────────────────────────────

  // Wire Norovision return button
  norovisionBtn.href = NOROVISION_URL;

  // Render all suppliers into the list (visible/scrollable by default)
  renderAllItems();
  updateCountHint();

  // Open the dropdown list on page load so the TV display is immediately usable
  openDropdown();

  // Start the 5-minute inactivity timer
  startInactivityTimer();

  // ── DROPDOWN RENDERING ────────────────────────────────────────────────────

  /**
   * Renders all supplier items as <li> elements into the dropdown.
   * Items are always present in the DOM; filtering toggles .is-hidden.
   * This is much faster for 400+ items than re-creating DOM on every keystroke.
   */
  function renderAllItems() {
    dropdownList.innerHTML = '';

    allSuppliers.forEach((supplier, index) => {
      const li = document.createElement('li');
      li.className = 'dropdown-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.id    = supplier.id;
      li.dataset.name  = supplier.name;
      li.dataset.index = index;
      li.textContent   = supplier.name;

      li.addEventListener('click', () => {
        onSupplierChosen(supplier);
        resetInactivityTimer();
      });

      li.addEventListener('mouseenter', () => {
        setHighlight(index);
      });

      dropdownList.appendChild(li);
    });
  }

  // ── DROPDOWN OPEN/CLOSE ───────────────────────────────────────────────────

  function openDropdown() {
    dropdownList.classList.add('is-open');
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    dropdownList.classList.remove('is-open');
    searchInput.setAttribute('aria-expanded', 'false');
    clearHighlight();
  }

  // ── SEARCH FILTERING ──────────────────────────────────────────────────────

  searchInput.addEventListener('input', () => {
    resetInactivityTimer();
    filterItems(searchInput.value.trim());
  });

  searchInput.addEventListener('focus', () => {
    openDropdown();
  });

  /**
   * Filters list items by toggling .is-hidden class.
   * Empty query → show all items.
   * @param {string} query
   */
  function filterItems(query) {
    const lower = query.toLowerCase();
    let visibleCount = 0;
    let firstVisibleIndex = -1;

    const items = dropdownList.querySelectorAll('.dropdown-item');

    // Remove existing empty-state message if present
    const emptyMsg = dropdownList.querySelector('.dropdown-empty');
    if (emptyMsg) emptyMsg.remove();

    items.forEach(item => {
      const name    = item.dataset.name.toLowerCase();
      const matches = query === '' || name.includes(lower);

      item.classList.toggle('is-hidden', !matches);
      if (matches) {
        visibleCount++;
        if (firstVisibleIndex === -1) firstVisibleIndex = parseInt(item.dataset.index, 10);
      }
    });

    // Show empty state if no matches
    if (visibleCount === 0) {
      const li = document.createElement('li');
      li.className = 'dropdown-empty';
      li.textContent = `No suppliers match "${query}"`;
      dropdownList.appendChild(li);
    }

    updateCountHint(visibleCount);
    clearHighlight();
    openDropdown();
  }

  // ── KEYBOARD NAVIGATION ───────────────────────────────────────────────────

  searchInput.addEventListener('keydown', (e) => {
    resetInactivityTimer();

    const visibleItems = getVisibleItems();
    if (!visibleItems.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (highlightedIndex + 1) % visibleItems.length;
      setHighlightByVisibleIndex(next, visibleItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = highlightedIndex <= 0
        ? visibleItems.length - 1
        : highlightedIndex - 1;
      setHighlightByVisibleIndex(prev, visibleItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && visibleItems[highlightedIndex]) {
        const id = visibleItems[highlightedIndex].dataset.id;
        const supplier = allSuppliers.find(s => s.id === id);
        if (supplier) onSupplierChosen(supplier);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  function getVisibleItems() {
    return Array.from(dropdownList.querySelectorAll('.dropdown-item:not(.is-hidden)'));
  }

  function setHighlight(allIndex) {
    clearHighlight();
    const items = dropdownList.querySelectorAll('.dropdown-item:not(.is-hidden)');
    // Find which visible-index corresponds to this allIndex
    const visible = Array.from(items);
    const vIdx = visible.findIndex(el => parseInt(el.dataset.index, 10) === allIndex);
    if (vIdx !== -1) setHighlightByVisibleIndex(vIdx, visible);
  }

  function setHighlightByVisibleIndex(vIdx, visibleItems) {
    clearHighlight();
    highlightedIndex = vIdx;
    const item = visibleItems[vIdx];
    if (!item) return;
    item.classList.add('is-highlighted');
    item.setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', item.id || '');
    // Scroll into view smoothly
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function clearHighlight() {
    highlightedIndex = -1;
    dropdownList.querySelectorAll('.dropdown-item.is-highlighted').forEach(el => {
      el.classList.remove('is-highlighted');
      el.setAttribute('aria-selected', 'false');
    });
    searchInput.removeAttribute('aria-activedescendant');
  }

  // ── CLOSE DROPDOWN ON OUTSIDE CLICK ──────────────────────────────────────

  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('dropdown-wrapper');
    if (!wrapper.contains(e.target) && !confirmModal.contains(e.target)) {
      closeDropdown();
    }
    resetInactivityTimer();
  });

  // ── SUPPLIER SELECTION & CONFIRMATION ─────────────────────────────────────

  /**
   * Called when the user clicks or keyboard-selects a supplier.
   * Stores the pending supplier and shows the confirmation modal.
   * @param {Object} supplier
   */
  function onSupplierChosen(supplier) {
    pendingSupplier = supplier;
    confirmNameEl.textContent = supplier.name;
    showModal();
  }

  // Modal confirm → navigate to Page 2
  confirmBtn.addEventListener('click', () => {
    if (!pendingSupplier) return;
    sessionStorage.setItem('selectedSupplierId', pendingSupplier.id);
    window.location.href = './supplier.html';
  });

  // Modal cancel → dismiss and clear pending
  cancelBtn.addEventListener('click', dismissModal);

  // Clicking the backdrop (outside modal-box) also cancels
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) dismissModal();
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmModal.classList.contains('is-visible')) {
      dismissModal();
    }
  });

  function showModal() {
    confirmModal.classList.add('is-visible');
    confirmBtn.focus();
  }

  function dismissModal() {
    confirmModal.classList.remove('is-visible');
    pendingSupplier = null;
    searchInput.focus();
  }

  // ── COUNT HINT ────────────────────────────────────────────────────────────

  /**
   * Updates the "Showing X of Y suppliers" hint below the search input.
   * @param {number|undefined} visible — undefined means show total
   */
  function updateCountHint(visible) {
    const total = allSuppliers.length;
    const shown = (visible !== undefined) ? visible : total;
    countHint.textContent = shown === total
      ? `${total} suppliers`
      : `${shown} of ${total} suppliers`;
  }

  // ── INACTIVITY TIMER ──────────────────────────────────────────────────────

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

});
