import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), metronGet: vi.fn() }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: {
    systemSetting: { findUnique: m.find, upsert: m.upsert, deleteMany: vi.fn(async () => ({})) },
    series: { findMany: vi.fn(async () => []) }, issue: { findMany: vi.fn(async () => []), createMany: vi.fn() },
} }));
vi.mock('@/lib/metron/client', () => ({
    getMetronAuth: vi.fn(async () => 'auth'), metronGet: m.metronGet,
    MetronHttpError: class extends Error {}, MetronRateLimitError: class extends Error {},
}));

import { GET } from '@/app/api/calendar/global/route';

const today = new Date().toISOString().slice(0, 10);
const req = (q: string) => new Request(`http://x/api/calendar/global?${q}`);

describe('GET /api/calendar/global from/to (fork)', () => {
    beforeEach(() => { m.find.mockReset(); m.upsert.mockReset(); m.metronGet.mockReset(); });

    it('serves a past range from the cache without asking Metron, whatever day it was fetched', async () => {
        m.find.mockResolvedValue({ value: JSON.stringify({ fetchedAt: '2020-01-01', releases: [{ id: 1 }] }) });
        const body = await (await GET(req('from=2020-01-06&to=2020-02-09'))).json();
        expect(body.releases).toEqual([{ id: 1 }]);
        expect(m.find).toHaveBeenCalledWith({ where: { key: 'calendar_global_v18_2020-01-06_2020-02-09' } });
        expect(m.metronGet).not.toHaveBeenCalled();
    });

    it('refetches a current range cached on an earlier day, in one pass for the whole range', async () => {
        m.find.mockResolvedValue({ value: JSON.stringify({ fetchedAt: '2020-01-01', releases: [] }) });
        m.metronGet.mockResolvedValue({ status: 200, data: { results: [{ id: 7, series: { name: 'X' }, number: '1', store_date: today }], next: null } });
        const body = await (await GET(req(`from=${today}&to=${today}`))).json();
        expect(body.releases.map((r: any) => r.id)).toEqual([7]);
        expect(m.metronGet.mock.calls[0][0]).toContain(`store_date_range_after=${today}&store_date_range_before=${today}`);
        expect(JSON.parse(m.upsert.mock.calls[0][0].create.value).fetchedAt).toBe(today);
    });

    it('rejects ranges over 45 days or bad dates', async () => {
        expect((await GET(req('from=2026-01-01&to=2026-03-01'))).status).toBe(400);
        expect((await GET(req('from=2026-1-1&to=2026-01-02'))).status).toBe(400);
    });
});
