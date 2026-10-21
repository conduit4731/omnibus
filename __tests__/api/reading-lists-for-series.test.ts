import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ issues: vi.fn(), items: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { issue: { findMany: m.issues }, readingListItem: { findMany: m.items } } }));
vi.mock('@/lib/reading-list-meta', () => ({
    listMeta: vi.fn(async (lists: any[]) => new Map(lists.map(l => [l.id, { category: l.id === 'ev' ? 'Events' : 'Characters' }]))),
}));

import { GET } from '@/app/api/reading-lists/for-series/route';

describe('GET /api/reading-lists/for-series (fork)', () => {
    it('finds lists by linked issue and by ComicVine id; chips only for events', async () => {
        m.issues.mockResolvedValue([{ id: 'i1', metadataId: '101' }, { id: 'i2', metadataId: '102' }]);
        const list = (id: string, name: string) => ({ id, name, description: null, updatedAt: new Date(0) });
        m.items.mockResolvedValue([
            { listId: 'ev', issueId: 'i1', cvIssueId: 101, list: list('ev', '[DC] Zero Year') },
            { listId: 'ev', issueId: null, cvIssueId: 102, list: list('ev', '[DC] Zero Year') },   // not linked yet
            { listId: 'ch', issueId: null, cvIssueId: 101, list: list('ch', 'Batman, Part 4') },
        ]);
        const body = await (await GET(new Request('http://x/api/reading-lists/for-series?seriesId=s1'))).json();

        expect(body.lists).toEqual([
            { id: 'ev', name: 'Zero Year', category: 'Events', issueCount: 2 },
            { id: 'ch', name: 'Batman, Part 4', category: 'Characters', issueCount: 1 },
        ]);
        expect(body.byIssue).toEqual({ i1: [{ id: 'ev', name: 'Zero Year' }], i2: [{ id: 'ev', name: 'Zero Year' }] });
    });
});
