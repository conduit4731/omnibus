import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ series: vi.fn(), issues: vi.fn(), items: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { series: { findUnique: m.series }, issue: { findMany: m.issues }, readingListItem: { findMany: m.items } } }));
vi.mock('@/lib/reading-list-meta', () => ({
    listMeta: vi.fn(async (lists: any[]) => new Map(lists.map(l => [l.id, { category: ({ ev: 'Events', mro: 'Master Reading Order' } as any)[l.id] || 'Characters' }]))),
}));

import { GET } from '@/app/api/reading-lists/for-series/route';

const list = (id: string, name: string) => ({ id, name, description: null, updatedAt: new Date(0) });

describe('GET /api/reading-lists/for-series (fork)', () => {
    it('lists by linked issue or ComicVine id; chips = era + events, not reading orders', async () => {
        m.series.mockResolvedValue({ publisher: 'DC Comics', year: 2011 });
        m.issues.mockResolvedValue([
            { id: 'i1', metadataId: '101', releaseDate: '2013-06-05' },
            { id: 'i2', metadataId: '102', releaseDate: '2016-08-01' },   // Rebirth by date
            { id: 'i3', metadataId: '103', releaseDate: null },           // falls back to the series year
        ]);
        m.items.mockResolvedValue([
            { listId: 'ev', issueId: 'i1', cvIssueId: 101, list: list('ev', '[DC] Zero Year') },
            { listId: 'ev', issueId: null, cvIssueId: 102, list: list('ev', '[DC] Zero Year') },   // not linked yet
            { listId: 'mro', issueId: 'i1', cvIssueId: 101, list: list('mro', 'New 52 Reading Order: New Part #1') },
            { listId: 'ch', issueId: null, cvIssueId: 101, list: list('ch', 'Batman, Part 4') },
        ]);
        const body = await (await GET(new Request('http://x/api/reading-lists/for-series?seriesId=s1'))).json();

        expect(body.lists.map((l: any) => [l.id, l.category, l.issueCount])).toEqual([['ev', 'Events', 2], ['ch', 'Characters', 1], ['mro', 'Master Reading Order', 1]]);
        const era = (name: string) => ({ name, kind: 'era', href: `/events?publisher=DC&era=${encodeURIComponent(name)}` });
        const event = { name: 'Zero Year', kind: 'event', href: '/reading-lists?id=ev' };
        expect(body.byIssue).toEqual({ i1: [era('New 52'), event], i2: [era('Rebirth'), event], i3: [era('New 52')] });
    });

    it('no era chip for publishers without named eras', async () => {
        m.series.mockResolvedValue({ publisher: 'Image', year: 2014 });
        m.issues.mockResolvedValue([{ id: 'i1', metadataId: null, releaseDate: '2014-01-01' }]);
        m.items.mockResolvedValue([]);
        const body = await (await GET(new Request('http://x/api/reading-lists/for-series?seriesId=s1'))).json();
        expect(body.byIssue).toEqual({});
    });
});
