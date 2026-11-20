/* =========================================================================
   placement.js — transparent placement rule for the optional diagnostic.
   share(level) = points / items at that level (1st try = 1, 2nd = 0.5).
   The rule never returns B2 or C1: this short test cannot place them.
   ========================================================================= */

export function placement(levelShares) {
  const a1 = levelShares.A1 ?? 0;
  const a2 = levelShares.A2 ?? 0;
  const b1 = levelShares.B1 ?? 0;
  if (b1 >= 0.6 && a2 >= 0.6) { return { range: 'B1+', startWeek: 9, key: 'diag.place.b1' }; }
  if (a1 >= 0.8 && a2 >= 0.6) { return { range: 'A2', startWeek: 5, key: 'diag.place.a2' }; }
  if (a1 >= 0.6) { return { range: 'A1', startWeek: 1, key: 'diag.place.a1' }; }
  return { range: 'Pre-A1–A1', startWeek: 1, key: 'diag.place.pre' };
}
