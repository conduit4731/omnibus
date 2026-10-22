import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: { readingListItem: { findMany } } }));

import { listMeta } from '@/lib/reading-list-meta';

const list = (id: string, updated: number) => ({ id, name: 'Zero Year', description: 'comics-ro: DC/Events/CBRO/2011-2015 - New 52/x.cbl', updatedAt: new Date(updated) });

describe('listMeta (fork)', () => {
    beforeEach(() => findMany.mockReset());

    it('classifies from items once and serves the cache until the list changes', async () => {
        findMany.mockResolvedValue([
            { listId: 'a', title: 'Batman (2011) #24', issue: { coverUrl: 'c1', series: { publisher: 'DC Comics', year: 2011 } } },
            { listId: 'a', title: 'Batman (2011) #25', issue: null },
            { listId: 'a', title: 'Batman (2011) #26', issue: { coverUrl: 'c2', series: { publisher: 'DC Comics', year: 2011 } } },
        ]);
        const first = await listMeta([list('a', 1)]);
        expect(first.get('a')).toEqual({ publisher: 'DC', category: 'Events', subject: null, era: 'New 52', eraStart: 2011, covers: ['c1', 'c2'], from: 2011, to: 2011 });

        await listMeta([list('a', 1)]);
        expect(findMany).toHaveBeenCalledTimes(1);   // cached

        findMany.mockResolvedValue([]);
        await listMeta([list('a', 2)]);               // list changed -> recomputed
        expect(findMany).toHaveBeenCalledTimes(2);
    });
});
