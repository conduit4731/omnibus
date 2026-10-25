// src/lib/batcave-queue.ts
//
// Fork only: the "Batcave" button next to every request button queues issues here; the userscript in an open
// Batcave tab (batcave/omnibus-batcave.user.js in the Unraid repo) fetches them via /api/batcave/worker, downloads
// them in the browser and uploads them through /api/batcave/upload. Server-side downloading is not possible:
// Batcave sits behind Cloudflare's bot check and needs the reader's login.
import path from 'path';
import { prisma } from '@/lib/db';
import { Logger } from '@/lib/logger';
import { isReleasedYet } from '@/lib/utils';
import { cachedCvGet } from '@/lib/metadata/metadata-cache';
import { syncSeriesMetadata } from '@/lib/metadata-fetcher';
import { followSeries } from '@/lib/follows';
import { seriesFolderSegments } from '@/lib/utils/naming';
import { normIssueNumber, normSeriesName, parseBatcaveTitle, pickCvVolume } from '@/lib/batcave';

export type QueueIssue = { number: string; isAnnual?: boolean };
export type QueueBody = {
    seriesId?: string | null;
    cvId?: number | string | null;
    title?: string;              // no id at all (unmatched download): "Name (Year)", resolved via ComicVine
    metadataSource?: string;
    issues?: QueueIssue[];       // absent = every missing, released issue
    readingListId?: string;      // a whole reading list / event
    listItemIds?: string[];      // or some of its items
    batch?: QueueBody[];         // several of the above in one press ("request all shown")
};

async function cvKey(): Promise<string> {
    const key = (await prisma.systemSetting.findUnique({ where: { key: 'cv_api_key' } }))?.value;
    if (!key) throw new Error('No ComicVine API key in Omnibus');
    return key;
}

/**
 * Adds a ComicVine volume like "Subscribe" does (folder from the naming pattern, metadata sync, followed), but NOT
 * monitored: the userscript fetches the issues, the gap backfill must not search them again on GetComics.
 * An existing series with that ComicVine id is returned as is.
 */
export async function addSeriesFromCv(
    vol: { id: number; name: string; start_year?: string | number | null; publisher?: { name?: string } | null },
    userId?: string | null,
    fallbackYear?: number,
) {
    const metadataId = String(vol.id);
    const existing = await prisma.series.findUnique({ where: { metadataSource_metadataId: { metadataSource: 'COMICVINE', metadataId } } });
    if (existing) return { series: existing, created: false };

    const settings = Object.fromEntries((await prisma.systemSetting.findMany({ where: { key: { in: ['folder_naming_pattern'] } } })).map(s => [s.key, s.value]));
    const libraries = await prisma.library.findMany();
    const lib = libraries.find(l => l.isDefault && !l.isManga) || libraries.find(l => !l.isManga) || libraries[0];
    const publisher = vol.publisher?.name || 'Unknown';
    const year = Number(vol.start_year) || fallbackYear || new Date().getFullYear();
    const parts = seriesFolderSegments(settings.folder_naming_pattern || '{Publisher}/{Series} ({Year})', { publisher, series: vol.name, seriesYear: year });
    if (!parts || !lib) throw new Error('Folder pattern / library gives no folder');
    const series = await prisma.series.create({
        data: {
            cvId: vol.id, metadataId, metadataSource: 'COMICVINE', matchState: 'MATCHED',
            name: vol.name, year, publisher, folderPath: path.join(lib.path, ...parts).replace(/\\/g, '/'),
            monitored: false, isManga: false, libraryId: lib.id,
        },
    });
    // Issue list from ComicVine: the queue needs the missing numbers, the import's scan needs rows to attach files to
    await syncSeriesMetadata(metadataId, series.folderPath, 'COMICVINE').catch(e => Logger.log(`[Batcave] metadata sync ${vol.name}: ${e}`, 'warn'));
    if (userId) await followSeries(userId, series.id).catch(() => {});
    Logger.log(`[Batcave] Added ${vol.name} (${year}) cv:${vol.id}`, 'info');
    return { series, created: true };
}

async function seriesForCvId(cvId: string, userId?: string | null) {
    const existing = await prisma.series.findUnique({ where: { metadataSource_metadataId: { metadataSource: 'COMICVINE', metadataId: cvId } } });
    if (existing) return existing;
    const res = await cachedCvGet(`https://comicvine.gamespot.com/api/volume/4050-${cvId}/`, {
        params: { api_key: await cvKey(), format: 'json', field_list: 'id,name,start_year,publisher' },
        headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 10000,
    });
    const vol = res.data?.results;
    if (!vol?.id) throw new Error(`ComicVine volume ${cvId} not found`);
    return (await addSeriesFromCv(vol, userId)).series;
}

/**
 * "Detective Comics – Endgame (2015)" → the ComicVine volume it means (pickCvVolume), added like addSeriesFromCv.
 * Throws with the closest hits when ComicVine has no unambiguous match.
 */
export async function seriesForTitle(title: string, userId?: string | null) {
    const key = await cvKey();
    const parsed = parseBatcaveTitle(title);
    const res = await cachedCvGet('https://comicvine.gamespot.com/api/search/', {
        params: { api_key: key, format: 'json', query: parsed?.name || title, resources: 'volume', limit: 50, field_list: 'id,name,start_year,publisher,count_of_issues' },
        headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 10000,
    });
    let hits = res.data?.results || [];
    let vol = pickCvVolume(hits, title);
    const name = normSeriesName(parsed?.name || title);
    const same = hits.filter((h: { name: string }) => normSeriesName(h.name) === name);
    if (!vol && same.length > 1) {
        // The search answers count_of_issues with 0 at times ("Invincible" 2003: two hits, both 0) — the
        // volume list has the real counts, which separate the series from its same-named TPBs.
        const counts = await cachedCvGet('https://comicvine.gamespot.com/api/volumes/', {
            params: { api_key: key, format: 'json', filter: `id:${same.slice(0, 50).map((h: { id: number }) => h.id).join('|')}`, field_list: 'id,count_of_issues', limit: 50 },
            headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 10000,
        });
        const byId = new Map<number, number>((counts.data?.results || []).map((r: { id: number; count_of_issues: number }) => [r.id, Number(r.count_of_issues) || 0]));
        hits = hits.map((h: { id: number; count_of_issues?: number }) => byId.has(h.id) ? { ...h, count_of_issues: byId.get(h.id) } : h);
        vol = pickCvVolume(hits, title);
    }
    if (!vol) {
        const near = hits.slice(0, 5).map((h: { name: string; start_year: unknown; count_of_issues?: number }) => `${h.name} (${h.start_year}, ${h.count_of_issues ?? '?'} Hefte)`);
        throw new Error(`${title}: bei ComicVine nicht eindeutig gefunden` + (near.length ? '. Treffer: ' + near.join('; ') : ', keine Treffer'));
    }
    return addSeriesFromCv(vol, userId, parsed?.year);
}

/** Released issues of a series that are not on disk. */
async function missingIssues(seriesId: string): Promise<QueueIssue[]> {
    const rows = await prisma.issue.findMany({ where: { seriesId, status: { not: 'DOWNLOADED' } }, select: { number: true, isAnnual: true, releaseDate: true } });
    return rows.filter(r => !r.releaseDate || isReleasedYet(r.releaseDate, null)).map(r => ({ number: r.number, isAnnual: r.isAnnual }));
}

/** Upserts jobs; an explicitly re-queued issue that failed or finished before goes back to QUEUED. */
export async function enqueue(seriesId: string, issues: QueueIssue[]): Promise<number> {
    let n = 0;
    for (const i of issues) {
        const number = normIssueNumber(i.number);
        if (!number) continue;
        const isAnnual = !!i.isAnnual;
        await prisma.batcaveJob.upsert({
            where: { seriesId_number_isAnnual: { seriesId, number, isAnnual } },
            update: { status: 'QUEUED', message: null },
            create: { seriesId, number, isAnnual },
        });
        n++;
    }
    return n;
}

/** Reading-list items → series + issue numbers; items not in the library are resolved through ComicVine in batches of 100. */
async function listTargets(readingListId?: string, listItemIds?: string[], userId?: string | null) {
    const items = await prisma.readingListItem.findMany({
        where: listItemIds?.length ? { id: { in: listItemIds } } : { listId: readingListId },
        select: { cvIssueId: true, metadataSource: true, issue: { select: { seriesId: true, number: true, isAnnual: true, status: true } } },
    });
    const targets = new Map<string, QueueIssue[]>();
    const add = (seriesId: string, i: QueueIssue) => targets.set(seriesId, [...(targets.get(seriesId) || []), i]);
    const cvIds: number[] = [];
    for (const it of items) {
        if (it.issue) { if (it.issue.status !== 'DOWNLOADED') add(it.issue.seriesId, { number: it.issue.number, isAnnual: it.issue.isAnnual }); }
        else if (it.cvIssueId && it.metadataSource === 'COMICVINE') cvIds.push(it.cvIssueId);
    }
    const key = cvIds.length ? await cvKey() : '';
    for (let i = 0; i < cvIds.length; i += 100) {
        const res = await cachedCvGet('https://comicvine.gamespot.com/api/issues/', {
            params: { api_key: key, format: 'json', filter: `id:${cvIds.slice(i, i + 100).join('|')}`, field_list: 'id,issue_number,volume', limit: 100 },
            headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 15000,
        });
        for (const r of res.data?.results || []) {
            if (!r.volume?.id || r.issue_number == null) continue;
            try {
                const s = await seriesForCvId(String(r.volume.id), userId);
                add(s.id, { number: String(r.issue_number) });
            } catch (e) {
                Logger.log(`[Batcave] list item cv:${r.id}: ${e}`, 'warn');
            }
        }
    }
    return targets;
}

/** Handles one button press. Returns the number of queued issues. */
export async function queueRequest(body: QueueBody, userId?: string | null): Promise<number> {
    if (body.batch?.length) {
        let n = 0;
        for (const b of body.batch.slice(0, 500)) n += await queueRequest({ ...b, batch: undefined }, userId).catch(() => 0);
        return n;
    }
    if (body.readingListId || body.listItemIds?.length) {
        let n = 0;
        for (const [seriesId, issues] of await listTargets(body.readingListId, body.listItemIds, userId)) n += await enqueue(seriesId, issues);
        return n;
    }
    let seriesId = body.seriesId;
    if (!seriesId && body.cvId) {
        const source = body.metadataSource || 'COMICVINE';
        if (source !== 'COMICVINE') {
            // Metron (release calendars): only a series that is already in the library; adding one goes through Subscribe
            const s = await prisma.series.findUnique({ where: { metadataSource_metadataId: { metadataSource: source, metadataId: String(body.cvId) } } });
            if (!s) throw new Error('Serie ist noch nicht in Omnibus: erst abonnieren, dann über Batcave laden');
            seriesId = s.id;
        } else {
            seriesId = (await seriesForCvId(String(body.cvId), userId)).id;
        }
    }
    if (!seriesId && body.title) seriesId = (await seriesForTitle(body.title, userId)).series.id;
    if (!seriesId) throw new Error('seriesId, cvId, title or readingListId required');
    return enqueue(seriesId, body.issues?.length ? body.issues : await missingIssues(seriesId));
}
