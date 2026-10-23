// src/lib/batcave.ts
//
// Fork-only: the Batcave userscript (Unraid repo, batcave/omnibus-batcave.user.js) asks which issues
// Omnibus already has and uploads the missing ones into the batcave-import.sh inbox.
// Pure helpers here; the routes live in src/app/api/batcave.

/** "New Avengers: Illuminati (2007)", "Secret Invasion Prologue (2008-)", "X (2011-2016) (New 52)" → name + start year. */
export function parseBatcaveTitle(title: string): { name: string; year: number } | null {
    const m = String(title || '').trim().match(/^(.+?)\s*\((\d{4})(?:-\d{0,4})?\)/);
    return m ? { name: m[1].trim(), year: Number(m[2]) } : null;
}

/** Comparable series name: Batcave and ComicVine differ in "The", "&"/"and", colons and dashes. */
export function normSeriesName(name: string): string {
    return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
}

/** Issue number as both sides can compare it: "001" → "1", "23.10" → "23.1", "½" stays as is. */
export function normIssueNumber(n: string | number): string {
    const s = String(n ?? '').trim();
    return /^\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s.toLowerCase();
}

type SeriesRow = { id: string; name: string; year: number; folderPath: string };

/**
 * Same name, start year within 1 (Batcave and ComicVine disagree by a year at times), closest year wins.
 * Batcave lists some series without a year ("Avengers: The Initiative"): then only an unambiguous name counts.
 */
export function pickSeries<T extends SeriesRow>(rows: T[], title: string): T | null {
    const t = parseBatcaveTitle(title);
    const key = normSeriesName(t ? t.name : title);
    if (!key) return null;
    const same = rows.filter(r => normSeriesName(r.name) === key);
    if (!t) return same.length === 1 ? same[0] : null;
    let best: T | null = null;
    for (const r of same) {
        if (Math.abs(r.year - t.year) > 1) continue;
        if (!best || Math.abs(r.year - t.year) < Math.abs(best.year - t.year)) best = r;
    }
    return best;
}

/** Upload file name batcave-import.sh understands: "<Series>_(<year>)_Issue_#7.cbz" / "…_Annual_#1.cbz". */
export function uploadFileName(seriesName: string, year: number, number: string, annual: boolean): string {
    const series = seriesName.replace(/[\\/:*?"<>|()#]/g, '').trim().replace(/\s+/g, '_');
    const num = normIssueNumber(number).replace(/[^0-9a-z.]/gi, '');
    return `${series}_(${year})_${annual ? 'Annual' : 'Issue'}_#${num}.cbz`;
}
