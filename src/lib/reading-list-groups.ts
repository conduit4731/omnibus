// Fork only: publisher / era grouping for the reading list picker.

type Era = { name: string, from: number };

// Start years of the publishers' named eras, oldest first. Anything else falls back to decades.
const ERAS: Record<string, Era[]> = {
    DC: [
        { name: 'Golden Age', from: 0 },
        { name: 'Silver Age', from: 1956 },
        { name: 'Bronze Age', from: 1970 },
        { name: 'Post-Crisis', from: 1986 },
        { name: 'New 52', from: 2011 },
        { name: 'Rebirth', from: 2016 },
        { name: 'Infinite Frontier', from: 2021 },
        { name: 'Dawn of DC', from: 2023 },
    ],
    Marvel: [
        { name: 'Golden Age', from: 0 },
        { name: 'Silver Age', from: 1956 },
        { name: 'Bronze Age', from: 1970 },
        { name: 'Modern Age', from: 1986 },
        { name: 'Marvel NOW!', from: 2012 },
        { name: 'All-New / Legacy', from: 2015 },
        { name: 'Fresh Start', from: 2018 },
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
