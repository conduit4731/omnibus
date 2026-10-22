// Fork only: what a search result is — ComicVine has no type for a volume, so it is read from the name, the issue
// count and the short description: an Annual run, a collected edition (TPB / hardcover / omnibus), a one-shot, or a
// regular series.
export type SearchKind = 'series' | 'annual' | 'collected' | 'one-shot';

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = { series: 'Series', annual: 'Annuals', collected: 'Collected', 'one-shot': 'One-shots' };

const COLLECTED = /\b(tpb|trade paperback|hardcover|hc|omnibus|compendium|deluxe edition|library edition|graphic novel|ogn|collects|collecting|collected edition)\b/i;

export function searchKind(r: { name?: string | null, count?: number | null, description?: string | null }): SearchKind {
    const name = r.name || '';
    if (/\bannuals?\b/i.test(name)) return 'annual';
    // only the start of the description: a series' long history often mentions its own collections further down
    if (COLLECTED.test(name) || COLLECTED.test((r.description || '').slice(0, 120))) return 'collected';
    if (r.count === 1) return 'one-shot';
    return 'series';
}
