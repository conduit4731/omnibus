import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ statUpsert: vi.fn(), issueUpsert: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { dailyReadingStat: { upsert: m.statUpsert }, dailyIssueRead: { upsert: m.issueUpsert } } }));
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));

import { readingSeconds, recordDailyReading } from '@/lib/reading-stats';
import { chartBuckets, formatDuration } from '@/components/reading-time-card';

describe('reading time (fork)', () => {
    beforeEach(() => { m.statUpsert.mockReset(); m.issueUpsert.mockReset(); });

    it('counts the gap since the last save only within one sitting', () => {
        const now = new Date('2026-10-21T12:00:00Z');
        expect(readingSeconds(new Date('2026-10-21T11:59:15Z'), now)).toBe(45);
        expect(readingSeconds(new Date('2026-10-21T11:55:00Z'), now)).toBe(300);   // exactly 5 min: still reading
        expect(readingSeconds(new Date('2026-10-21T11:54:59Z'), now)).toBe(0);     // a break
        expect(readingSeconds(null, now)).toBe(0);                                 // first open
        expect(readingSeconds(new Date('2026-10-21T12:00:10Z'), now)).toBe(0);     // clock skew
    });

    it('records time even when paging back (no new pages)', async () => {
        await recordDailyReading('u', 'i', 0, new Date(Date.now() - 30_000));
        expect(m.issueUpsert).toHaveBeenCalledWith(expect.objectContaining({
            update: { pagesRead: { increment: 0 }, secondsRead: { increment: 30 } },
        }));
    });

    it('writes nothing without pages and time', async () => {
        await recordDailyReading('u', 'i', 0, new Date(Date.now() - 3_600_000));
        expect(m.issueUpsert).not.toHaveBeenCalled();
    });

    it('formats and buckets for the chart', () => {
        expect(formatDuration(59 * 60)).toBe('59 min');
        expect(formatDuration(135 * 60)).toBe('2 h 15 min');
        const b = chartBuckets([{ date: '2026-10-20', seconds: 600 }], 3, new Date('2026-10-21T12:00:00Z'));
        expect(b).toEqual([{ label: '10.19', minutes: 0 }, { label: '10.20', minutes: 10 }, { label: '10.21', minutes: 0 }]);
        expect(chartBuckets([{ date: '2026-09-01', seconds: 60 }, { date: '2026-09-30', seconds: 120 }], 0)).toEqual([{ label: '2026-09', minutes: 3 }]);
    });
});
