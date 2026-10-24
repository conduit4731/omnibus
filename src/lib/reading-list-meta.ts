// Fork only: per-list display data for the list picker, Events and Characters pages: publisher, category,
// era and up to three cover URLs. Computing it needs every item of every list (90k+ with the full CBL
// catalog), so it is cached per list and recomputed only when the list's updatedAt changes.
import { prisma } from '@/lib/db';
import { classifyList, eraFor, medianYear, starWarsEra, subjectOf, yearFromTitle } from '@/lib/reading-list-groups';

export type ListMeta = { publisher: string, category: string, subject: string | null, era: string, eraStart: number, covers: string[], from: number | null, to: number | null };
type ListRow = { id: string, name: string, description: string | null, updatedAt: Date };

// shortcut: in-memory per server process; the first overview after a restart pays for all lists once.
const cache = new Map<string, { stamp: number, meta: ListMeta }>();

export async function listMeta(lists: ListRow[]): Promise<Map<string, ListMeta>> {
    const missing = lists.filter(l => cache.get(l.id)?.stamp !== l.updatedAt.getTime());
    if (missing.length > 0) {
        const items = await prisma.readingListItem.findMany({
            where: { listId: { in: missing.map(l => l.id) } },
            orderBy: { order: 'asc' },
            select: { listId: true, title: true, year: true, issue: { select: { coverUrl: true, releaseDate: true, series: { select: { publisher: true, year: true } } } } },
        });
        const byList = new Map<string, typeof items>();
        for (const item of items) byList.set(item.listId, [...(byList.get(item.listId) || []), item]);
        for (const l of missing) {
            const rows = byList.get(l.id) || [];
            const { publisher, category } = classifyList(l, rows.map(r => r.issue?.series?.publisher ?? null));
            const years = rows.map(r => r.issue?.series?.year ?? yearFromTitle(r.title)).filter((y): y is number => !!y);
            const covers = rows.flatMap(r => r.issue?.coverUrl ? [r.issue.coverUrl] : []).slice(0, 3);
            // Fork: first and last year the list's issues came out: the CBL's issue year, else the linked issue's release
            // date. Not the year in the title — that is the series' start ("Batman (1940) #497" came out in 1993).
            const released = rows.map(r => r.year || parseInt(r.issue?.releaseDate?.slice(0, 4) || '', 10)).filter((y): y is number => !!y);
            const from = released.length ? Math.min(...released) : null, to = released.length ? Math.max(...released) : null;
            // Era from when the issues came out (Knightfall is 1993, not Batman's 1940 start); series years only as fallback
            cache.set(l.id, { stamp: l.updatedAt.getTime(), meta: { publisher, category, subject: subjectOf(l.description), ...(publisher === 'Star Wars' ? starWarsEra(l.name) : eraFor(publisher, medianYear(released.length ? released : years))), covers, from, to } });
        }
    }
    return new Map(lists.map(l => [l.id, cache.get(l.id)!.meta]));
}
