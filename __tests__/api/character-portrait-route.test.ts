import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), upsert: vi.fn(), del: vi.fn(), cv: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: m.session }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { systemSetting: { findUnique: m.find, upsert: m.upsert, deleteMany: m.del } } }));
vi.mock('@/lib/metadata/metadata-cache', () => ({ cachedCvGet: m.cv }));

import { GET, POST } from '@/app/api/characters/portrait/route';

const blank = { medium_url: 'https://comicvine.gamespot.com/a/uploads/scale_medium/11122/111222211/6373148-blank.png' };
const get = (q: string) => GET(new Request(`http://x/api/characters/portrait?${q}`));
const post = (body: object) => POST(new Request('http://x/api/characters/portrait', { method: 'POST', body: JSON.stringify(body) }));

describe('character portrait route (fork)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        m.session.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
        m.find.mockImplementation(async ({ where }: any) => where.key === 'cv_api_key' ? { value: 'k' } : null);
    });

    it('fills placeholder images from /characters/ and never remembers a placeholder', async () => {
        m.cv.mockImplementation(async (url: string) => url.endsWith('/search/')
            ? { data: { results: [{ id: 1, name: 'Flash', image: blank, publisher: null }] } }
            : { data: { results: [{ id: 1, image: { medium_url: 'https://cv/barry.jpg' }, publisher: { name: 'DC Comics' } }] } });
        const body = await (await get('name=Flash&publisher=DC')).json();
        expect(body.url).toBe('https://cv/barry.jpg');
        expect(m.cv.mock.calls[1][1].params.filter).toBe('id:1');
        expect(m.upsert.mock.calls[0][0].create.value).toBe('https://cv/barry.jpg');
    });

    it('lists candidates with images only', async () => {
        m.cv.mockResolvedValue({ data: { results: [
            { id: 1, name: 'Flash', image: { medium_url: 'https://cv/barry.jpg' }, publisher: { name: 'DC Comics' }, deck: 'Barry Allen' },
            { id: 2, name: 'Flash', image: null, publisher: { name: 'DC Comics' } },
        ] } });
        const body = await (await get('name=Flash&publisher=DC&candidates=1')).json();
        expect(body.candidates).toEqual([{ name: 'Flash', publisher: 'DC Comics', deck: 'Barry Allen', url: 'https://cv/barry.jpg' }]);
    });

    it('admins set a portrait by hand and reset it; others may not', async () => {
        expect((await (await post({ name: 'Flash', publisher: 'DC', url: 'https://img/wally.jpg' })).json()).url).toBe('https://img/wally.jpg');
        expect(m.upsert.mock.calls[0][0]).toEqual(expect.objectContaining({ where: { key: 'character_portrait:DC:Flash' }, create: { key: 'character_portrait:DC:Flash', value: 'https://img/wally.jpg' } }));
        await post({ name: 'Flash', publisher: 'DC', url: '' });
        expect(m.del).toHaveBeenCalledWith({ where: { key: 'character_portrait:DC:Flash' } });
        expect((await post({ name: 'Flash', publisher: 'DC', url: 'javascript:alert(1)' })).status).toBe(400);
        m.session.mockResolvedValue({ user: { id: 'u', role: 'USER' } });
        expect((await post({ name: 'Flash', publisher: 'DC', url: 'https://img/x.jpg' })).status).toBe(403);
    });
});
