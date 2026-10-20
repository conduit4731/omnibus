import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/automation', () => ({ searchAndDownload: vi.fn() }));

import { pickBackfill, type Gap } from '@/lib/backfill-wanted';

const gap = (number: string, releaseDate: string | null, volumeId = '42722'): Gap => ({
    volumeId, metadataSource: 'COMICVINE', seriesName: 'Catwoman', seriesYear: 2011,
    publisher: 'DC Comics', isManga: false, number, releaseDate,
});

describe('pickBackfill (fork)', () => {
    it('takes released gaps without a request, oldest first, up to the limit', () => {
        const picked = pickBackfill(
            [gap('3', '2012-01-04'), gap('1', '2011-09-21'), gap('2', '2011-10-19'), gap('4', '2012-02-01')],
            [{ volumeId: '42722', activeDownloadName: 'Catwoman #2' }],
            2,
        );
        expect(picked.map(g => g.number)).toEqual(['1', '3']);
    });

    it('skips unreleased and undated issues', () => {
        expect(pickBackfill([gap('99', '2999-01-01'), gap('98', null)], [], 10)).toEqual([]);
    });

    it('matches existing requests per volume, also with titles and padding', () => {
        const picked = pickBackfill(
            [gap('7', '2012-05-01'), gap('7', '2012-05-01', '99999')],
            [{ volumeId: '42722', activeDownloadName: 'Catwoman #007: Some Title' }],
            10,
        );
        expect(picked.map(g => g.volumeId)).toEqual(['99999']);
    });
});
