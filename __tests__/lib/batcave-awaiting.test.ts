// __tests__/lib/batcave-awaiting.test.ts
// Fork: queueAwaitingForBatcave puts AWAITING_RELEASE requests on the Batcave queue once, closes the ones Batcave
// already downloaded, leaves NOT_FOUND alone and spends at most maxLookups ComicVine lookups per run.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
    requests: [] as any[],
    jobs: new Map<string, any>(),
    updated: [] as any[],
    created: [] as any[],
    cvGet: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        request: {
            findMany: vi.fn(async () => m.requests),
            update: vi.fn(async (a: any) => { m.updated.push(a); return a; }),
        },
        series: {
            findFirst: vi.fn(async ({ where }: any) => where.OR[0].metadataId === '100' ? { id: 's100' } : null),
            findUnique: vi.fn(async () => null),
        },
        batcaveJob: {
            findUnique: vi.fn(async ({ where }: any) => {
                const k = where.seriesId_number_isAnnual;
                return m.jobs.get(`${k.seriesId}|${k.number}`) || null;
            }),
            create: vi.fn(async (a: any) => { m.created.push(a.data); return a.data; }),
        },
        systemSetting: { findUnique: vi.fn(async () => ({ value: 'cv-key' })) },
    },
}));
vi.mock('@/lib/metadata/metadata-cache', () => ({ cachedCvGet: m.cvGet }));
vi.mock('@/lib/metadata-fetcher', () => ({ syncSeriesMetadata: vi.fn() }));
vi.mock('@/lib/follows', () => ({ followSeries: vi.fn() }));
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));

import { queueAwaitingForBatcave } from '@/lib/batcave-queue';

describe('queueAwaitingForBatcave', () => {
    beforeEach(() => {
        m.jobs.clear(); m.updated = []; m.created = [];
        m.cvGet.mockReset().mockResolvedValue({ data: { results: [] } }); // ComicVine finds nothing
    });

    it('queues new ones, closes DONE ones, keeps NOT_FOUND, caps lookups', async () => {
        m.jobs.set('s100|2', { status: 'DONE' });
        m.jobs.set('s100|3', { status: 'NOT_FOUND' });
        m.requests = [
            { id: 'a', volumeId: '100', metadataSource: 'COMICVINE', issueNumber: null, activeDownloadName: 'Flash #1' },
            { id: 'b', volumeId: '100', metadataSource: 'COMICVINE', issueNumber: '2', activeDownloadName: 'Flash #2' },
            { id: 'c', volumeId: '100', metadataSource: 'COMICVINE', issueNumber: '3', activeDownloadName: 'Flash #3' },
            { id: 'd', volumeId: '0', metadataSource: 'COMICVINE', issueNumber: '1', activeDownloadName: 'Steel (2011) #1' },
            { id: 'e', volumeId: '0', metadataSource: 'COMICVINE', issueNumber: '1', activeDownloadName: 'Batgirl (2011) #1.cbz' },
        ];
        const r = await queueAwaitingForBatcave(null, 1);
        expect(m.created).toEqual([{ seriesId: 's100', number: '1' }]);
        expect(m.updated.map(u => u.where.id)).toEqual(['b']);
        expect(r).toMatchObject({ queued: 1, completed: 1, lookups: 1, waiting: 5 });
        expect(m.cvGet).toHaveBeenCalledTimes(1); // Steel looked up (and not found), Batgirl waits for the next run
    });
});
