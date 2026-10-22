// Fork only: publisher / era grouping for the reading list picker.

type Era = { name: string, from: number, month?: number };  // month: first month of the era (1-12), for issue chips

// Start years of the publishers' named eras, oldest first. Anything else falls back to decades.
const ERAS: Record<string, Era[]> = {
    DC: [
        { name: 'Golden Age', from: 0 },
        { name: 'Silver Age', from: 1956 },
        { name: 'Bronze Age', from: 1970 },
        { name: 'Post-Crisis', from: 1986 },
        { name: 'New 52', from: 2011, month: 9 },
        { name: 'Rebirth', from: 2016, month: 6 },
        { name: 'Infinite Frontier', from: 2021, month: 3 },
        { name: 'Dawn of DC', from: 2023 },
    ],
    Marvel: [
        { name: 'Golden Age', from: 0 },
        { name: 'Silver Age', from: 1956 },
        { name: 'Bronze Age', from: 1970 },
        { name: 'Modern Age', from: 1986 },
        { name: 'Marvel NOW!', from: 2012, month: 10 },
        { name: 'All-New / Legacy', from: 2015, month: 10 },
        { name: 'Fresh Start', from: 2018, month: 5 },
        { name: 'Modern Marvel', from: 2021 },
    ],
};

/** "DC Comics" -> "DC", "Marvel Comics" / "Marvel" -> "Marvel"; null for unknown. */
export function normalizePublisher(name?: string | null): string | null {
    const n = (name || '').replace(/\b(comics|entertainment|publishing)\b/gi, '').trim();
    if (!n || /^unknown$/i.test(n)) return null;
    if (/^dc\b/i.test(n)) return 'DC';
    if (/^marvel\b/i.test(n)) return 'Marvel';
    return n;
}

/** Era name and its sort key (start year) for a publisher and a year; null year = "Unknown era". */
export function eraFor(publisher: string, year: number | null): { era: string, eraStart: number } {
    if (year === null) return { era: 'Unknown era', eraStart: 9999 };
    const eras = ERAS[publisher];
    if (!eras) {
        const decade = Math.floor(year / 10) * 10;
        return { era: `${decade}s`, eraStart: decade };
    }
    const era = [...eras].reverse().find(e => year >= e.from)!;
    return { era: era.name, eraStart: era.from };
}

/** The publisher's named era ("New 52") for an issue's year and month (1-12); null when the publisher has no
 *  named eras. Month-precise: Batman #1 of August 2011 is still before the New 52 (September 2011). */
export function namedEra(publisher: string | null, year: number | null, month = 12): string | null {
    const eras = publisher ? ERAS[publisher] : undefined;
    if (!eras || year === null) return null;
    return [...eras].reverse().find(e => year > e.from || (year === e.from && month >= (e.month ?? 1)))!.name;
}

/** Median of the years, or null when there are none. */
export function medianYear(years: number[]): number | null {
    if (years.length === 0) return null;
    const sorted = [...years].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Year from an item title such as "Batman (2011) #24". */
export function yearFromTitle(title?: string | null): number | null {
    const m = title?.match(/\((1[89]\d\d|20\d\d)\)/);
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Publisher and category of a list. Lists imported by path (description "comics-ro: DC/Events/…")
 * say it themselves; otherwise the most common publisher among the linked series, then a "[DC …]"
 * name prefix.
 */
export function classifyList(list: { name: string, description?: string | null }, seriesPublishers: (string | null)[]) {
    const path = list.description?.startsWith('comics-ro: ') ? list.description.slice('comics-ro: '.length).split('/') : null;
    let publisher = path && path.length > 1 ? normalizePublisher(path[0]) : null;
    if (!publisher) {
        const counts = new Map<string, number>();
        for (const p of seriesPublishers.map(normalizePublisher)) if (p) counts.set(p, (counts.get(p) || 0) + 1);
        publisher = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    if (!publisher) publisher = normalizePublisher(list.name.match(/^\[([^\]]+)\]/)?.[1]);
    const category = path && path.length > 2 ? path[1] : 'Lists';
    return { publisher: publisher ?? 'Other', category };
}

/** Character a "comics-ro: DC/Characters/<name>/…" list is about ("unsorted/<name>" skipped); null otherwise. */
export function subjectOf(description?: string | null): string | null {
    if (!description?.startsWith('comics-ro: ')) return null;
    const parts = description.slice('comics-ro: '.length).split('/');
    if (parts[1] !== 'Characters' || parts.length < 4) return null;
    return parts[2] === 'unsorted' ? parts[3] : parts[2];
}

/** Best ComicVine character result: exact name first, publisher must match when the result names one. */
export function pickPortrait(results: any[], name: string, publisher: string): string | null {
    const fits = results.filter(r => !r?.publisher?.name || normalizePublisher(r.publisher.name) === publisher);
    const bare = (n?: string) => (n || '').toLowerCase().replace(/^the\s+/, '').trim();
    const appearances = (r: any) => Number(r?.count_of_issue_appearances) || 0;
    const known = [...fits].sort((a, b) => appearances(b) - appearances(a))[0];
    const exact = fits.find(r => bare(r?.name) === bare(name));
    // An exact name only wins if it isn't a minor namesake: "The Flash" is Barry Allen (thousands of
    // appearances), not the DC character literally called "Flash" (a handful).
    const best = exact && appearances(exact) * 10 >= appearances(known) ? exact : known || exact;
    return best?.image?.medium_url || best?.image?.original_url || null;
}

/** "[Marvel] Civil War" -> "Civil War": the publisher is shown separately (shared by API and cards). */
export const displayListName = (name: string) => name.replace(/^\s*\[[^\]]*\]\s*/, '');
