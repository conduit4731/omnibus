// Fork only: request every released gap (WANTED issue) of monitored series, not just the 30 highest
// numbers the Series Monitor looks at. Runs at the end of SERIES_MONITOR, oldest gaps first, capped
// per run so the search queue and GetComics' rate limit are not flooded.
import { prisma } from '@/lib/db';
import { isReleasedYet } from '@/lib/utils';
import { extractIssueNumber, isSameIssue } from '@/lib/utils/issue-parser';
import { searchAndDownload } from '@/lib/automation';
import { normIssueNumber } from '@/lib/batcave';

export const BACKFILL_PER_RUN = 100;

export type Gap = {
    volumeId: string, metadataSource: string, seriesName: string, seriesYear: number | null,
    publisher: string | null, isManga: boolean, number: string, releaseDate: string | null,
};

/** Released gaps without any request yet (any status: a cancelled one stays cancelled) and not on the Batcave
 *  queue (`onBatcave`: "volumeId|number"), oldest first. */
export function pickBackfill(gaps: Gap[], existing: { volumeId: string | null, activeDownloadName: string | null }[], limit: number, onBatcave = new Set<string>()): Gap[] {
    return gaps
        .filter(g => g.releaseDate && isReleasedYet(g.releaseDate, null)) // dateless = probably just solicited
        .filter(g => !onBatcave.has(`${g.volumeId}|${normIssueNumber(g.number)}`))
        .filter(g => !existing.some(r => r.volumeId === g.volumeId
            && isSameIssue(extractIssueNumber(r.activeDownloadName || ''), g.number)))
        .sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!))
        .slice(0, limit);
}

/** Creates PENDING requests for the picked gaps and starts their searches; returns their names. */
export async function backfillWantedGaps(userId: string, limit = BACKFILL_PER_RUN): Promise<string[]> {
    const rows = await prisma.issue.findMany({
        where: { status: 'WANTED', filePath: null, isAnnual: false, series: { monitored: true, metadataId: { not: null } } },
        select: {
            number: true, releaseDate: true,
            series: { select: { id: true, metadataId: true, metadataSource: true, name: true, year: true, publisher: true, isManga: true } },
        },
    });
    const gaps: Gap[] = rows.map(r => ({
        volumeId: r.series.metadataId!, metadataSource: r.series.metadataSource || 'COMICVINE',
        seriesName: r.series.name, seriesYear: r.series.year, publisher: r.series.publisher,
        isManga: !!r.series.isManga, number: r.number, releaseDate: r.releaseDate,
    }));
    const existing = await prisma.request.findMany({
        where: { volumeId: { in: [...new Set(gaps.map(g => g.volumeId))] } },
        select: { volumeId: true, activeDownloadName: true },
    });
    // Queued for or already uploaded by the Batcave userscript: a GetComics request would fetch it a second time
    const volumeOf = new Map(rows.map(r => [r.series.id, r.series.metadataId!]));
    const jobs = await prisma.batcaveJob.findMany({
        where: { seriesId: { in: [...volumeOf.keys()] }, status: { in: ['QUEUED', 'DONE'] }, isAnnual: false },
        select: { seriesId: true, number: true },
    });
    const onBatcave = new Set(jobs.map(j => `${volumeOf.get(j.seriesId)}|${normIssueNumber(j.number)}`));

    const queued: string[] = [];
    for (const g of pickBackfill(gaps, existing, limit, onBatcave)) {
        const name = `${g.seriesName} #${g.number}`;
        const req = await prisma.request.create({
            data: { userId, volumeId: g.volumeId, metadataSource: g.metadataSource, status: 'PENDING', activeDownloadName: name },
        });
        const year = g.releaseDate?.split('-')[0] || String(g.seriesYear || '');
        searchAndDownload(req.id, name, year, g.publisher || 'Unknown', g.isManga).catch(() => {});
        queued.push(name);
    }
    return queued;
}
