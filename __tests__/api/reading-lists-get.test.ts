import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/reading-lists/route';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    listFindMany: vi.fn(),
    listFindFirst: vi.fn(),
    itemFindMany: vi.fn(),
    progressFindMany: vi.fn(),
    issueFindMany: vi.fn(),
    itemGroupBy: vi.fn(),
}));

vi.mock('next-auth/next', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/reading-list-meta', () => ({
    listMeta: vi.fn(async (lists: any[]) => new Map(lists.map(l => [l.id, { publisher: 'DC', category: 'Events', era: 'New 52', eraStart: 2011, covers: [] }]))),
}));
vi.mock('@/lib/library-access', () => ({ getAccessibleLibraryIds: vi.fn().mockResolvedValue('ALL') }));
vi.mock('@/lib/db', () => ({
    prisma: {
        readingList: { findMany: mocks.listFindMany, findFirst: mocks.listFindFirst },
        readingListItem: { findMany: mocks.itemFindMany, groupBy: mocks.itemGroupBy, update: vi.fn() },
        readProgress: { findMany: mocks.progressFindMany },
        issue: { findMany: mocks.issueFindMany },
        $transaction: vi.fn(),
    }
}));

const req = (query = '') => new Request(`http://localhost/api/reading-lists${query}`);

describe('GET /api/reading-lists (#252 / #253)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'user_1', role: 'ADMIN' } });
    });

    it('returns only list summaries with item / owned / read counts, never the items', async () => {
        mocks.listFindMany.mockResolvedValue([{ id: 'l1', name: 'Zero Year' }, { id: 'l2', name: 'Empty' }]);
        mocks.progressFindMany.mockResolvedValue([{ issueId: 'i1' }]);
        // counted by the database: all items, items whose issue has a file, items the user completed
        mocks.itemGroupBy.mockImplementation(async ({ where }: any) =>
            where.issue ? [{ listId: 'l1', _count: { _all: 2 } }]
            : where.issueId ? [{ listId: 'l1', _count: { _all: 1 } }]
            : [{ listId: 'l1', _count: { _all: 4 } }]);

        const body = await (await GET(req())).json();

        expect(mocks.listFindMany.mock.calls[0][0].include.items).toBeUndefined();
        expect(mocks.itemFindMany).not.toHaveBeenCalled();
        expect(mocks.itemGroupBy.mock.calls.find((c: any) => c[0].where.issueId)?.[0].where.issueId).toEqual({ in: ['i1'] });
        expect(body).toEqual([
            { id: 'l1', name: 'Zero Year', itemCount: 4, ownedCount: 2, readCount: 1, publisher: 'DC', category: 'Events', era: 'New 52', eraStart: 2011, covers: [] },
            { id: 'l2', name: 'Empty', itemCount: 0, ownedCount: 0, readCount: 0, publisher: 'DC', category: 'Events', era: 'New 52', eraStart: 2011, covers: [] },
        ]);
    });

    it('returns one list with each item carrying the user\'s progress', async () => {
        mocks.listFindFirst.mockResolvedValue({ id: 'l1', items: [
            { id: 'a', issueId: 'i1', cvIssueId: null },
            { id: 'b', issueId: 'i2', cvIssueId: null },
            { id: 'c', issueId: null, cvIssueId: null },
        ] });
        mocks.progressFindMany.mockResolvedValue([{ issueId: 'i1', currentPage: 21, totalPages: 22, isCompleted: true }]);

        const res = await GET(req('?id=l1'));
        const body = await res.json();

        expect(mocks.progressFindMany.mock.calls[0][0].where).toEqual({ userId: 'user_1', issueId: { in: ['i1', 'i2'] } });
        expect(body.items.map((i: any) => i.progress)).toEqual([
            { issueId: 'i1', currentPage: 21, totalPages: 22, isCompleted: true }, null, null
        ]);
    });

    it('404s a list the user cannot see', async () => {
        mocks.listFindFirst.mockResolvedValue(null);
        expect((await GET(req('?id=nope'))).status).toBe(404);
    });
});
