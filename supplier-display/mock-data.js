// ══════════════════════════════════════════════════════════════════════════════
// mock-data.js — Supplier data layer (prototype with mock data)
//
// PRODUCTION REPLACEMENT GUIDE:
//   getEligibleSuppliers() → fetch from batch API (daily refresh endpoint)
//   getActiveOrderLines()  → fetch from real-time API (Phoenix DC Packer Out status)
//   SUPPLIERS array        → remove; data comes from API responses
// ══════════════════════════════════════════════════════════════════════════════

// ── SUPPLIERS ARRAY ───────────────────────────────────────────────────────────
// Each supplier object schema:
// {
//   id:           string  — unique key used in sessionStorage/localStorage
//   name:         string  — display name
//   signedDate:   string | null — ISO 8601 date of partnership signing, or null
//   top5Branches: string[] — ordered array, index 0 = rank #1 (by revenue, last 365 days)
//   skuCount:     number  — active SKUs on website as of prior day snapshot
//   regionSplit:  { americas: number, emea: number, apac: number } — must sum to 100
//   channelSplit: { online: number, traditional: number }          — must sum to 100
// }

const SUPPLIERS = [
  {
    id: 'SUP-001',
    name: 'Acme Components',
    signedDate: '2008-03-15',   // ~17 years → rounds to 17
    top5Branches: ['Phoenix, AZ', 'Dallas, TX', 'Chicago, IL', 'Atlanta, GA', 'Seattle, WA'],
    skuCount: 4820,
    regionSplit:  { americas: 52, emea: 28, apac: 20 },
    channelSplit: { online: 63, traditional: 37 }
  },
  {
    id: 'SUP-002',
    name: 'Allied Electronics Group',
    signedDate: '2019-09-01',   // ~6.5 years → rounds to 7
    top5Branches: ['Los Angeles, CA', 'Phoenix, AZ', 'Houston, TX', 'Miami, FL', 'Denver, CO'],
    skuCount: 2315,
    regionSplit:  { americas: 70, emea: 18, apac: 12 },
    channelSplit: { online: 45, traditional: 55 }
  },
  {
    id: 'SUP-003',
    name: 'Arrow Semiconductor Supply',
    signedDate: '2025-11-20',   // < 1 year → displays "1 Year"
    top5Branches: ['Phoenix, AZ', 'San Jose, CA', 'Austin, TX', 'Portland, OR', 'Boston, MA'],
    skuCount: 891,
    regionSplit:  { americas: 80, emea: 12, apac: 8 },
    channelSplit: { online: 78, traditional: 22 }
  },
  {
    id: 'SUP-004',
    name: 'Avnet Distribution Partners',
    signedDate: null,           // No signed date → displays "Valued Partner"
    top5Branches: ['Phoenix, AZ', 'New York, NY', 'Chicago, IL', 'Los Angeles, CA', 'Dallas, TX'],
    skuCount: 6742,
    regionSplit:  { americas: 45, emea: 35, apac: 20 },
    channelSplit: { online: 39, traditional: 61 }
  },
  {
    id: 'SUP-005',
    name: 'Benchmark Passive Components',
    signedDate: '2015-06-30',   // ~10.7 years → rounds to 11
    top5Branches: ['Phoenix, AZ', 'Detroit, MI', 'Minneapolis, MN', 'Kansas City, MO', 'Nashville, TN'],
    skuCount: 3190,
    regionSplit:  { americas: 38, emea: 42, apac: 20 },
    channelSplit: { online: 51, traditional: 49 }
  },
  {
    id: 'SUP-006',
    name: 'Bourns Resistive Products',
    signedDate: '2001-04-10',   // ~25 years → rounds to 25
    top5Branches: ['Phoenix, AZ', 'San Diego, CA', 'Raleigh, NC', 'Columbus, OH', 'Indianapolis, IN'],
    skuCount: 9543,
    regionSplit:  { americas: 34, emea: 31, apac: 35 },
    channelSplit: { online: 29, traditional: 71 }
  },
  {
    id: 'SUP-007',
    name: 'C2G Cable Solutions',
    signedDate: null,           // No signed date → displays "Valued Partner"
    top5Branches: ['Phoenix, AZ', 'Louisville, KY', 'Memphis, TN', 'Birmingham, AL', 'Richmond, VA'],
    skuCount: 1267,
    regionSplit:  { americas: 91, emea: 6, apac: 3 },
    channelSplit: { online: 82, traditional: 18 }
  },
  {
    id: 'SUP-008',
    name: 'Cinch Connectivity Solutions',
    signedDate: '2012-01-22',   // ~14.1 years → rounds to 14
    top5Branches: ['Phoenix, AZ', 'Chicago, IL', 'Milwaukee, WI', 'St. Louis, MO', 'Oklahoma City, OK'],
    skuCount: 5088,
    regionSplit:  { americas: 57, emea: 27, apac: 16 },
    channelSplit: { online: 44, traditional: 56 }
  },
  {
    id: 'SUP-009',
    name: 'Digi-Key Technology Partners',
    signedDate: '2022-07-19',   // ~3.6 years → rounds to 4
    top5Branches: ['Phoenix, AZ', 'Salt Lake City, UT', 'Boise, ID', 'Spokane, WA', 'Albuquerque, NM'],
    skuCount: 18720,
    regionSplit:  { americas: 48, emea: 22, apac: 30 },
    channelSplit: { online: 91, traditional: 9 }
  },
  {
    id: 'SUP-010',
    name: 'Eaton Power Solutions',
    signedDate: '2017-03-05',   // ~9.0 years → rounds to 9
    top5Branches: ['Phoenix, AZ', 'Cleveland, OH', 'Pittsburgh, PA', 'Baltimore, MD', 'Hartford, CT'],
    skuCount: 2843,
    regionSplit:  { americas: 40, emea: 45, apac: 15 },
    channelSplit: { online: 33, traditional: 67 }
  },
  {
    id: 'SUP-011',
    name: 'Flex-Cable International',
    signedDate: '2020-11-11',   // ~5.3 years → rounds to 5
    top5Branches: ['Phoenix, AZ', 'El Paso, TX', 'San Antonio, TX', 'Tucson, AZ', 'Las Vegas, NV'],
    skuCount: 742,
    regionSplit:  { americas: 76, emea: 14, apac: 10 },
    channelSplit: { online: 68, traditional: 32 }
  },
  {
    id: 'SUP-012',
    name: 'Fujitsu Electronic Components',
    signedDate: '2005-08-28',   // ~20.5 years → rounds to 21
    top5Branches: ['Phoenix, AZ', 'San Jose, CA', 'Seattle, WA', 'Portland, OR', 'Sacramento, CA'],
    skuCount: 3976,
    regionSplit:  { americas: 25, emea: 20, apac: 55 },
    channelSplit: { online: 57, traditional: 43 }
  },
  {
    id: 'SUP-013',
    name: 'General Cable Manufacturing',
    signedDate: null,           // No signed date → displays "Valued Partner"
    top5Branches: ['Phoenix, AZ', 'Cincinnati, OH', 'Louisville, KY', 'Charlotte, NC', 'Tampa, FL'],
    skuCount: 4103,
    regionSplit:  { americas: 63, emea: 22, apac: 15 },
    channelSplit: { online: 36, traditional: 64 }
  },
  {
    id: 'SUP-014',
    name: 'Harting Industrial Connectors',
    signedDate: '2013-05-14',   // ~12.8 years → rounds to 13
    top5Branches: ['Phoenix, AZ', 'Detroit, MI', 'Buffalo, NY', 'Albany, NY', 'Rochester, NY'],
    skuCount: 2217,
    regionSplit:  { americas: 30, emea: 58, apac: 12 },
    channelSplit: { online: 41, traditional: 59 }
  },
  {
    id: 'SUP-015',
    name: 'ITT Cannon Connector Division',
    signedDate: '2010-12-01',   // ~15.2 years → rounds to 15
    top5Branches: ['Phoenix, AZ', 'Los Angeles, CA', 'San Francisco, CA', 'Oakland, CA', 'Fresno, CA'],
    skuCount: 6891,
    regionSplit:  { americas: 44, emea: 33, apac: 23 },
    channelSplit: { online: 52, traditional: 48 }
  },
  {
    id: 'SUP-016',
    name: 'Keystone Electronics Corp',
    signedDate: '2023-02-28',   // ~3.0 years → rounds to 3
    top5Branches: ['Phoenix, AZ', 'New York, NY', 'Newark, NJ', 'Philadelphia, PA', 'Washington, DC'],
    skuCount: 8540,
    regionSplit:  { americas: 82, emea: 12, apac: 6 },
    channelSplit: { online: 74, traditional: 26 }
  },
  {
    id: 'SUP-017',
    name: 'Littelfuse Circuit Protection',
    signedDate: '2003-07-17',   // ~22.6 years → rounds to 23
    top5Branches: ['Phoenix, AZ', 'Chicago, IL', 'St. Paul, MN', 'Omaha, NE', 'Des Moines, IA'],
    skuCount: 5673,
    regionSplit:  { americas: 49, emea: 29, apac: 22 },
    channelSplit: { online: 48, traditional: 52 }
  },
  {
    id: 'SUP-018',
    name: 'Molex Global Interconnect',
    signedDate: '2009-10-05',   // ~16.4 years → rounds to 16
    top5Branches: ['Phoenix, AZ', 'Chicago, IL', 'Milwaukee, WI', 'Rockford, IL', 'Aurora, IL'],
    skuCount: 12341,
    regionSplit:  { americas: 36, emea: 34, apac: 30 },
    channelSplit: { online: 61, traditional: 39 }
  },
  {
    id: 'SUP-019',
    name: 'Murata Manufacturing Americas',
    signedDate: '2016-04-20',   // ~9.9 years → rounds to 10
    top5Branches: ['Phoenix, AZ', 'Atlanta, GA', 'Orlando, FL', 'Jacksonville, FL', 'Savannah, GA'],
    skuCount: 7824,
    regionSplit:  { americas: 28, emea: 17, apac: 55 },
    channelSplit: { online: 70, traditional: 30 }
  },
  {
    id: 'SUP-020',
    name: 'Nichicon Capacitor Division',
    signedDate: '2018-08-15',   // ~7.5 years → rounds to 8
    top5Branches: ['Phoenix, AZ', 'San Jose, CA', 'Austin, TX', 'Dallas, TX', 'Houston, TX'],
    skuCount: 3412,
    regionSplit:  { americas: 31, emea: 19, apac: 50 },
    channelSplit: { online: 55, traditional: 45 }
  }
];

// ── HELPER FUNCTIONS ──────────────────────────────────────────────────────────

/**
 * Returns the list of suppliers eligible for display.
 * Eligibility = revenue activity in the last rolling 365 days.
 *
 * PRODUCTION: Replace this function body with:
 *   const response = await fetch('/api/suppliers/eligible');
 *   return response.json();
 *
 * For prototype: returns all suppliers in the SUPPLIERS array (all are considered
 * to have revenue in the last 365 days for demonstration purposes).
 */
function getEligibleSuppliers() {
  return SUPPLIERS;
}

/**
 * Simulates a real-time Phoenix DC query for active order lines in "Packer Out"
 * status for the given supplier.
 *
 * Returns a random integer between 0 and 12 (inclusive) to exercise both the
 * "show real-time bar" and "hide real-time bar" display paths during demos.
 *
 * PRODUCTION: Replace this function body with:
 *   const response = await fetch(`/api/realtime/active-lines?supplierId=${supplierId}&dc=phoenix`);
 *   const data = await response.json();
 *   return data.activeLineCount;
 *
 * NOTE: The caller wraps this in Promise.resolve() so the real async fetch()
 * replacement will work without any changes to the calling code.
 *
 * REGION NOTE: Query is scoped to Phoenix DC only, as specified in requirements.
 *
 * @param {string} supplierId
 * @returns {number} count of active order lines (0–12 in mock)
 */
function getActiveOrderLines(supplierId) {
  // Weighted toward 0 so demo doesn't always show the real-time bar
  const outcomes = [0, 0, 0, 1, 2, 3, 5, 7, 9, 12, 0, 0, 4];
  return outcomes[Math.floor(Math.random() * outcomes.length)];
}
