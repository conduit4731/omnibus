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
 * Same name and the SAME start year. No ±1 tolerance: "The Flash (2010)" (vol. 3) and "The Flash (2011)"
 * (New 52) are different volumes; real year disagreements are settled once by /api/batcave/subscribe via
 * ComicVine and remembered in BATCAVE_MAP_KEY. Batcave lists some series without a year ("Avengers: The
 * Initiative"): then only an unambiguous name counts.
 */
export function pickSeries<T extends SeriesRow>(rows: T[], title: string): T | null {
    const t = parseBatcaveTitle(title);
    const key = normSeriesName(t ? t.name : title);
    if (!key) return null;
    const same = rows.filter(r => normSeriesName(r.name) === key);
    if (!t) return same.length === 1 ? same[0] : null;
    return same.find(r => r.year === t.year) || null;
}

/** SystemSetting holding { titleKey(title): seriesId } for titles resolved via ComicVine. */
export const BATCAVE_MAP_KEY = 'batcave_series_map';
export const titleKey = (title: string) => normSeriesName(title);

type CvVolume = { id: number; name: string; start_year: string | number | null; publisher?: { name?: string } | null };

/** ComicVine search hits → the volume a Batcave title means: same name, exact start year, else the only one within ±1 / the only one at all. */
export function pickCvVolume(results: CvVolume[], title: string): CvVolume | null {
    const t = parseBatcaveTitle(title);
    const key = normSeriesName(t ? t.name : title);
    const same = results.filter(r => normSeriesName(r.name) === key);
    if (!t) return same.length === 1 ? same[0] : null;
    const exact = same.filter(r => Number(r.start_year) === t.year);
    if (exact.length) return exact.length === 1 ? exact[0] : null;
    const near = same.filter(r => Math.abs(Number(r.start_year) - t.year) <= 1);
    return near.length === 1 ? near[0] : null;
}

/** Upload file name batcave-import.sh understands: "<Series>_(<year>)_Issue_#7.cbz" / "…_Annual_#1.cbz". */
export function uploadFileName(seriesName: string, year: number, number: string, annual: boolean): string {
    const series = seriesName.replace(/[\\/:*?"<>|()#]/g, '').trim().replace(/\s+/g, '_');
    const num = normIssueNumber(number).replace(/[^0-9a-z.]/gi, '');
    return `${series}_(${year})_${annual ? 'Annual' : 'Issue'}_#${num}.cbz`;
}
