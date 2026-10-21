// Fork only: date ranges for the release calendar's day / week / month / year views.
// All dates are UTC calendar days ("YYYY-MM-DD"), like Issue.releaseDate; weeks start on Monday.

export type CalendarView = 'day' | 'week' | 'month' | 'year';

const DAY = 86400000;
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
/** Monday of the week containing d. */
export const mondayOf = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

/** First and last day the view shows; a month spans whole weeks so the grid has no gaps. */
export function rangeFor(view: CalendarView, anchor: Date): { from: string, to: string } {
    if (view === 'day') return { from: iso(anchor), to: iso(anchor) };
    if (view === 'week') { const m = mondayOf(anchor); return { from: iso(m), to: iso(addDays(m, 6)) }; }
    if (view === 'year') return { from: `${anchor.getUTCFullYear()}-01-01`, to: `${anchor.getUTCFullYear()}-12-31` };
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return { from: iso(mondayOf(first)), to: iso(addDays(mondayOf(last), 6)) };
}

/** The anchor one step back (-1) or forward (+1) in the given view. */
export function shift(view: CalendarView, anchor: Date, dir: -1 | 1): Date {
    if (view === 'day') return addDays(anchor, dir);
    if (view === 'week') return addDays(anchor, 7 * dir);
    if (view === 'year') return new Date(Date.UTC(anchor.getUTCFullYear() + dir, anchor.getUTCMonth(), 1));
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + dir, 1));
}

/** weekOffset values of /api/calendar/global (Sunday–Saturday weeks relative to today) covering from..to. */
export function globalWeekOffsets(from: string, to: string, today: Date): number[] {
    const sunday = (d: Date) => addDays(d, -d.getUTCDay());
    const base = sunday(parseDay(iso(today))).getTime();
    const offsets: number[] = [];
    for (let w = sunday(parseDay(from)); w <= parseDay(to); w = addDays(w, 7)) offsets.push(Math.round((w.getTime() - base) / (7 * DAY)));
    return offsets;
}

/** Days from..to inclusive. */
export function daysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = parseDay(from); d <= parseDay(to); d = addDays(d, 1)) out.push(iso(d));
    return out;
}
