// Fork only: date ranges for the release calendar. Comics ship on Wednesdays, so the covers and compact
// views both show one release week and step a week at a time; the year view is the overview.
// All dates are UTC calendar days ("YYYY-MM-DD"), like Issue.releaseDate; weeks start on Monday.

export type CalendarView = 'covers' | 'compact' | 'year';

const DAY = 86400000;
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
/** Monday of the week containing d. */
export const mondayOf = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

/** First and last day the view shows: the Monday–Sunday release week, or the whole year. */
export function rangeFor(view: CalendarView, anchor: Date): { from: string, to: string } {
    if (view === 'year') return { from: `${anchor.getUTCFullYear()}-01-01`, to: `${anchor.getUTCFullYear()}-12-31` };
    const m = mondayOf(anchor);
    return { from: iso(m), to: iso(addDays(m, 6)) };
}

/** Whole weeks around a month, for the year view's small month grids. */
export function monthGrid(month: Date): { from: string, to: string } {
    const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    return { from: iso(mondayOf(first)), to: iso(addDays(mondayOf(last), 6)) };
}

/** The anchor one week (covers, compact) or one year back (-1) or forward (+1). */
export function shift(view: CalendarView, anchor: Date, dir: -1 | 1): Date {
    if (view === 'year') return new Date(Date.UTC(anchor.getUTCFullYear() + dir, anchor.getUTCMonth(), 1));
    return addDays(anchor, 7 * dir);
}

/** from..to cut into consecutive pieces of at most maxDays days (the global pull list takes up to 45 per call). */
export function chunks(from: string, to: string, maxDays: number): { from: string, to: string }[] {
    const out: { from: string, to: string }[] = [];
    for (let d = parseDay(from); d <= parseDay(to); d = addDays(d, maxDays)) {
        const end = addDays(d, maxDays - 1);
        out.push({ from: iso(d), to: end < parseDay(to) ? iso(end) : to });
    }
    return out;
}

/** Days from..to inclusive. */
export function daysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = parseDay(from); d <= parseDay(to); d = addDays(d, 1)) out.push(iso(d));
    return out;
}
