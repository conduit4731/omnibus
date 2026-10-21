import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ reads: vi.fn(), items: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { dailyIssueRead: { findMany: m.reads }, readingListItem: { findMany: m.items } } }));

import { GET } from '@/app/api/user/reading-time/route';

describe('GET /api/user/reading-time (fork)', () => {
    it('sums per day, series and list; an issue twice in a list counts once', async () => {
        const series = { name: 'Voodoo', year: 2011, folderPath: '/data/comics/Voodoo (2011)' };
        m.reads.mockResolvedValue([
            { date: new Date('2026-10-20T00:00:00Z'), secondsRead: 600, pagesRead: 20, issueId: 'i1', issue: { seriesId: 's1', series } },
            { date: new Date('2026-10-21T00:00:00Z'), secondsRead: 300, pagesRead: 10, issueId: 'i1', issue: { seriesId: 's1', series } },
            { date: new Date('2026-10-21T00:00:00Z'), secondsRead: 120, pagesRead: 5, issueId: 'i2', issue: { seriesId: 's1', series } },
        ]);
        m.items.mockResolvedValue([
            { issueId: 'i1', listId: 'l1', list: { name: '[DC] The New 52' } },
            { issueId: 'i1', listId: 'l1', list: { name: '[DC] The New 52' } },
            { issueId: 'i2', listId: 'l2', list: { name: 'Voodoo Event' } },
        ]);
        const body = await (await GET(new Request('http://x/api/user/reading-time?days=0'))).json();

        expect(body.totalSeconds).toBe(1020);
        expect(body.daily).toEqual([{ date: '2026-10-20', seconds: 600 }, { date: '2026-10-21', seconds: 420 }]);
        expect(body.series).toEqual([{ id: 's1', name: 'Voodoo', year: 2011, path: '/data/comics/Voodoo (2011)', seconds: 1020, pages: 35, issues: 2 }]);
        expect(body.lists).toEqual([
            { id: 'l1', name: 'The New 52', seconds: 900, issues: 1 },
            { id: 'l2', name: 'Voodoo Event', seconds: 120, issues: 1 },
        ]);
    });
});
