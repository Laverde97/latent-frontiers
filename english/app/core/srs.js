/* =========================================================================
   srs.js — spaced repetition (adapted SM-2).

   Each vocabulary item has a card { ef, reps, interval, due, lapses,
   history }. A review is graded with a quality q in 0..5 that comes from
   performance, never from simply viewing the item:

     5  correct on first try, quickly (typed / chosen without hint)
     4  correct on first try
     3  correct after a second attempt or rated "Hard" after recall
     1  wrong, or rated "Again"

   Rules (Wozniak's SM-2, with two documented adaptations):
     - q < 3  -> lapse: reps = 0, interval = 0, due in 10 minutes
                 (re-learn inside the same session; SM-2 uses 1 day).
     - q >= 3 -> reps += 1; interval = 1 day (reps 1), 3 days (reps 2;
                 SM-2 uses 6 — shorter for beginners), else
                 round(interval * ef).
     - ef' = max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
   An item counts as "learned" only after 2+ successful reviews with
   interval >= 3 days, and "mastered" from interval >= 21 days.
   ========================================================================= */

const DAY = 24 * 60 * 60 * 1000;
const RELEARN_MS = 10 * 60 * 1000;

export function newCard(now = new Date()) {
  return { ef: 2.5, reps: 0, interval: 0, due: now.toISOString(), lapses: 0, history: [] };
}

export function review(card, q, now = new Date()) {
  if (!(q >= 0 && q <= 5)) { throw new RangeError('quality must be 0..5'); }
  const c = { ...card, history: [...(card.history || [])] };
  if (q < 3) {
    c.reps = 0;
    c.interval = 0;
    c.lapses = (c.lapses || 0) + 1;
    c.due = new Date(now.getTime() + RELEARN_MS).toISOString();
  } else {
    c.reps += 1;
    if (c.reps === 1) { c.interval = 1; } else if (c.reps === 2) { c.interval = 3; } else { c.interval = Math.round(c.interval * c.ef); }
    c.due = new Date(now.getTime() + c.interval * DAY).toISOString();
  }
  c.ef = Math.max(1.3, c.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  c.ef = Math.round(c.ef * 1000) / 1000;
  c.history.push({ at: now.toISOString(), q });
  if (c.history.length > 50) { c.history = c.history.slice(-50); }
  return c;
}

export function isDue(card, now = new Date()) {
  return !card || new Date(card.due).getTime() <= now.getTime();
}

export function cardStage(card) {
  if (!card || card.reps === 0) { return card && card.history.length ? 'learning' : 'new'; }
  if (card.interval >= 21) { return 'mastered'; }
  if (card.reps >= 2 && card.interval >= 3) { return 'learned'; }
  return 'learning';
}

/* Quality from an objective attempt. */
export function qualityFromAttempt({ correct, attempts = 1, hinted = false, fast = false }) {
  if (!correct) { return 1; }
  if (attempts > 1 || hinted) { return 3; }
  return fast ? 5 : 4;
}

/* Items to review now: due cards first (oldest due first), then items
   seen in completed lessons that have no card yet. */
export function dueItems(srs, candidateIds, now = new Date(), limit = 20) {
  const due = candidateIds
    .filter((id) => srs[id] && isDue(srs[id], now))
    .sort((a, b) => new Date(srs[a].due) - new Date(srs[b].due));
  return due.slice(0, limit);
}

export function countDue(srs, now = new Date()) {
  return Object.values(srs).filter((c) => isDue(c, now)).length;
}
