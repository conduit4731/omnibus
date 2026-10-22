import { describe, it, expect } from 'vitest';
import { buildInsights, type IssueRow } from '@/lib/library-insights';

const series = (publisher: string, metadataId: string | null = '1', status = 'Ended') =>
    ({ name: publisher + ' Series', year: 2011, folderPath: '/data/comics/x', publisher, metadataId, status });
const row = (seriesId: string, s: IssueRow['series'], o: Partial<IssueRow> = {}): IssueRow =>
    ({ seriesId, series: s, filePath: '/f.cbz', releaseDate: '2013-01-01', fileAddedAt: new Date('2026-09-15T00:00:00Z'), read: false, ...o });

describe('buildInsights (fork)', () => {
    it('counts read / unread / missing per publisher, years, growth, backlog and upcoming weeks', () => {
        const dc = series('DC Comics'), loose = series('DC Comics', 'unmatched_x'), img = series('Image', '2', 'Ongoing');
        const rows = [
            row('s1', dc, { read: true }),
            row('s1', dc),
            row('s1', dc, { filePath: null }),                                   // released, missing
            row('s1', dc, { filePath: null, releaseDate: null }),                // unknown date counts as released
            row('s1', dc, { filePath: null, releaseDate: '2026-11-05' }),        // upcoming (Thu) -> week of Mon 11-02
            row('s2', loose, { filePath: null }),                                // unmatched: never "missing"
            row('s2', loose, { fileAddedAt: new Date('2026-10-02T00:00:00Z') }),
            row('s3', img, { releaseDate: '2024-05-01' }),
        ];
        const r = buildInsights(rows, '2026-10-21');

        expect(r.kpis).toEqual({ series: 3, issues: 4, bytes: 0, read: 1, complete: 1, ongoing: 1, missing: 2, upcoming: 1 });
        expect(r.byPublisher).toEqual([{ publisher: 'DC', read: 1, unread: 2, missing: 2, bytes: 0 }, { publisher: 'Image', read: 0, unread: 1, missing: 0, bytes: 0 }]);
        expect(r.byYear).toEqual([{ year: 2013, DC: 3 }, { year: 2024, Image: 1 }]);
        expect(r.growth).toEqual([{ month: '2026-09-15', added: 3, total: 3 }, { month: '2026-10-02', added: 1, total: 4 }]);  // 2 months: by day
        expect(r.backlog.map(b => [b.id, b.unread])).toEqual([['s1', 1], ['s2', 1], ['s3', 1]]);
        expect(r.upcoming).toEqual([{ week: '2026-11-02', issues: 1 }]);
    });

    it('a matched series with every released issue is complete; small publishers fold into Other', () => {
        const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((p, i) => row(`s${i}`, series(p)));
        const r = buildInsights(rows, '2026-10-21');
        expect(r.kpis.complete).toBe(7);
        expect(r.publishers).toEqual(['A', 'B', 'C', 'D', 'E', 'Other']);
    });

    it('sums file sizes per publisher and overall, owned files only', () => {
        const dc = series('DC Comics');
        const r = buildInsights([row('s1', dc, { bytes: 40e6 }), row('s1', dc, { bytes: 60e6 }), row('s1', dc, { filePath: null, bytes: 99e6 })], '2026-10-21');
        expect(r.kpis.bytes).toBe(100e6);
        expect(r.byPublisher[0].bytes).toBe(100e6);
    });

    it('issues without a publisher are "Unknown", not a second "Other"; long histories grow by month', () => {
        const rows = [row('s1', series(null as any)), ...['2026-01-05', '2026-03-05', '2026-06-05'].map(d => row('s2', series('DC'), { fileAddedAt: new Date(d) }))];
        const r = buildInsights(rows, '2026-10-21');
        expect(r.publishers).toEqual(['DC', 'Unknown']);
        expect(r.growth.map(g => g.month)).toEqual(['2026-01', '2026-03', '2026-06', '2026-09']);
    });
});
