import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
const visible = vi.hoisted(() => new Set<string>());
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: {
    systemSetting: {
        findUnique: vi.fn(async ({ where }: any) => store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null),
        upsert: vi.fn(async ({ where, update }: any) => { store.set(where.key, update.value); }),
        deleteMany: vi.fn(async ({ where }: any) => { store.delete(where.key); }),
    },
    readingList: { findFirst: vi.fn(async ({ where }: any) => visible.has(where.id) ? { id: where.id } : null) },
} }));

import { GET, PUT } from '@/app/api/reading-lists/favorites/route';

const put = async (listId: string, favorite: boolean) =>
    PUT(new Request('http://x/api/reading-lists/favorites', { method: 'PUT', body: JSON.stringify({ listId, favorite }) }));

describe('reading list favorites (fork)', () => {
    beforeEach(() => { store.clear(); visible.clear(); ['a', 'b', 'c'].forEach(id => visible.add(id)); });

    it('takes over the old single main list as the first favorite', async () => {
        store.set('reading_list_main:u1', 'a');
        expect((await (await GET()).json()).listIds).toEqual(['a']);
    });

    it('keeps several favorites in the order they were starred, removes one, and drops the old key', async () => {
        store.set('reading_list_main:u1', 'a');
        await put('b', true);
        expect((await (await put('c', true)).json()).listIds).toEqual(['a', 'b', 'c']);
        expect((await (await put('b', false)).json()).listIds).toEqual(['a', 'c']);
        expect(store.has('reading_list_main:u1')).toBe(false);
    });

    it('refuses a list the user cannot see', async () => {
        expect((await put('secret', true)).status).toBe(404);
    });
});
