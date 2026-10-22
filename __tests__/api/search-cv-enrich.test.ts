import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fork: ComicVine's /search/ returns placeholder volumes; the route fills them from /volumes/ in one call.
const m = vi.hoisted(() => ({ cv: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { systemSetting: { findMany: m.findMany, findUnique: m.findUnique, upsert: m.upsert } } }));
vi.mock('@/lib/metadata/providers/metron', () => ({ MetronProvider: class {} }));
vi.mock('@/lib/metadata/metadata-cache', () => ({ cachedCvGet: m.cv }));

import { GET } from '@/app/api/search/route';

const blank = { medium_url: 'https://comicvine.gamespot.com/a/uploads/scale_medium/11122/111222211/6373148-blank.png' };
const bare = (id: number, start_year: string) => ({ id, name: 'Detective Comics', start_year, publisher: null, count_of_issues: 0, image: blank, deck: 'Volume 1' });

describe('GET /api/search - ComicVine placeholders (fork)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.findMany.mockResolvedValue([{ key: 'cv_api_key', value: 'k' }, { key: 'filter_foreign_publishers', value: 'Panini' }]);
        m.findUnique.mockResolvedValue(null);
        m.upsert.mockResolvedValue({});
    });

    it('fills publisher, issue count, cover and description from /volumes/, then filters foreign publishers', async () => {
        m.cv.mockImplementation(async (url: string) => url.endsWith('/search/')
            ? { data: { results: [bare(18058, '1937'), bare(42, '2016')], number_of_total_results: 2 } }
            : { data: { results: [
                { id: 18058, publisher: { name: 'DC Comics' }, count_of_issues: 1100, image: { medium_url: 'https://cv/18058.jpg' }, deck: null, description: '<p>Batman</p>' },
                { id: 42, publisher: { name: 'Panini' }, count_of_issues: 12, image: { medium_url: 'https://cv/42.jpg' }, deck: 'German', description: null },
            ] } });
        const body = await (await GET(new Request('http://localhost/api/search?q=Detective%20Comics'))).json();

        expect(m.cv.mock.calls[1][1].params.filter).toBe('id:18058|42');
        expect(body.results).toEqual([expect.objectContaining({ id: 18058, publisher: 'DC Comics', count: 1100, description: 'Batman',
            image: `/api/library/cover?path=${encodeURIComponent('https://cv/18058.jpg')}` })]);
    });

    it('keeps the bare results when /volumes/ fails', async () => {
        m.cv.mockImplementation(async (url: string) => {
            if (url.endsWith('/search/')) return { data: { results: [bare(18058, '1937')], number_of_total_results: 1 } };
            throw new Error('420');
        });
        const body = await (await GET(new Request('http://localhost/api/search?q=Detective%20Comics'))).json();
        expect(body.results.map((r: any) => [r.id, r.publisher])).toEqual([[18058, 'Other']]);
    });
});
