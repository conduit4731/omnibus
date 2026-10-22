// Fork only: library insights (see /api/library/insights) — collection by publisher, release years, growth,
// unread backlog and upcoming issues, from one pass over every issue row.
import { normalizePublisher } from '@/lib/reading-list-groups';

/** Series.status from ComicVine / Metron: "Ended", "Completed", "Cancelled" end a run; anything else is ongoing. */
export const isEndedStatus = (status?: string | null) => !!status && /ended|completed|cancel/i.test(status);

const TOP_PUBLISHERS = 5;

export type IssueRow = {
    seriesId: string, filePath: string | null, releaseDate: string | null, fileAddedAt: Date | null, read: boolean,
    bytes?: number,  // file size on disk (the route stats the files)
    series: { name: string, year: number | null, folderPath: string | null, publisher: string | null, metadataId: string | null, status: string | null },
};

export function buildInsights(rows: IssueRow[], today = new Date().toISOString().slice(0, 10)) {
    // "Other" is the small-publisher bucket; a series without a publisher (some say literally "Other") is "Unknown"
    const pub = (r: IssueRow) => { const p = normalizePublisher(r.series.publisher); return !p || /^other$/i.test(p) ? 'Unknown' : p; };
    const matched = (r: IssueRow) => /^\d+$/.test(r.series.metadataId || '');
    const owned = rows.filter(r => r.filePath);
    const released = (r: IssueRow) => !r.releaseDate || r.releaseDate.slice(0, 10) <= today;

    // Top publishers by owned issues; the rest is "Other"
    const pubCount = new Map<string, number>();
    for (const r of owned) pubCount.set(pub(r), (pubCount.get(pub(r)) || 0) + 1);
    const top = [...pubCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_PUBLISHERS).map(e => e[0]);
    const bucket = (r: IssueRow) => top.includes(pub(r)) ? pub(r) : 'Other';

    const byPublisher = new Map<string, { publisher: string, read: number, unread: number, missing: number, bytes: number }>();
    const byYear = new Map<number, Record<string, number>>();
    const byMonth = new Map<string, number>(), byDay = new Map<string, number>();
    const perSeries = new Map<string, { id: string, name: string, year: number | null, path: string | null, owned: number, unread: number, released: number, status: string | null, matched: boolean }>();
    const upcoming = new Map<string, number>();
    const in8Weeks = new Date(new Date(today).getTime() + 56 * 86400000).toISOString().slice(0, 10);

    for (const r of rows) {
        const b = bucket(r);
        const p = byPublisher.get(b) || { publisher: b, read: 0, unread: 0, missing: 0, bytes: 0 };
        const s = perSeries.get(r.seriesId) || { id: r.seriesId, name: r.series.name, year: r.series.year, path: r.series.folderPath, owned: 0, unread: 0, released: 0, status: r.series.status, matched: matched(r) };
        if (released(r)) s.released++;
        if (r.filePath) {
            s.owned++;
            p.bytes += r.bytes || 0;
            if (r.read) p.read++; else { p.unread++; s.unread++; }
            const y = parseInt(r.releaseDate?.slice(0, 4) || '', 10) || r.series.year;
            if (y) { const e = byYear.get(y) || {}; e[b] = (e[b] || 0) + 1; byYear.set(y, e); }
            if (r.fileAddedAt) {
                const d = r.fileAddedAt.toISOString().slice(0, 10);
                byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) || 0) + 1); byDay.set(d, (byDay.get(d) || 0) + 1);
            }
        } else if (released(r) && matched(r)) {
            p.missing++;
        } else if (r.releaseDate && r.releaseDate.slice(0, 10) > today && r.releaseDate.slice(0, 10) <= in8Weeks) {
            // Monday of the release week as the bucket
            const d = new Date(`${r.releaseDate.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
            const w = d.toISOString().slice(0, 10); upcoming.set(w, (upcoming.get(w) || 0) + 1);
        }
        byPublisher.set(b, p);
        perSeries.set(r.seriesId, s);
    }

    // Per month; a library that is only a month or two old gets days, or the chart is a single dot
    let total = 0;
    const steps = byMonth.size <= 2 ? byDay : byMonth;
    const growth = [...steps.entries()].sort().map(([month, added]) => ({ month, added, total: (total += added) }));
    const series = [...perSeries.values()].filter(s => s.owned > 0);
    return {
        publishers: [...top, ...(byPublisher.has('Other') ? ['Other'] : [])],
        kpis: {
            series: series.length,
            issues: owned.length,
            bytes: owned.reduce((n, r) => n + (r.bytes || 0), 0),
            read: owned.filter(r => r.read).length,
            complete: series.filter(s => s.matched && s.owned >= s.released).length,
            ongoing: series.filter(s => s.status && !isEndedStatus(s.status)).length,
            missing: [...byPublisher.values()].reduce((n, p) => n + p.missing, 0),
            upcoming: [...upcoming.values()].reduce((n, c) => n + c, 0),
        },
        byPublisher: [...byPublisher.values()].sort((a, b) => (b.read + b.unread) - (a.read + a.unread)),
        byYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, counts]) => ({ year, ...counts })),
        growth,
        backlog: series.filter(s => s.unread > 0).sort((a, b) => b.unread - a.unread).slice(0, 8)
            .map(({ id, name, year, path, unread, owned }) => ({ id, name, year, path, unread, owned })),
        upcoming: [...upcoming.entries()].sort().map(([week, issues]) => ({ week, issues })),
    };
}
