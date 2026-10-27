// Settings shows saved custom headers masked as '********'; "Refresh Indexers" must send the saved value, not the mask.
import { describe, it, expect, vi } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('axios', () => ({ default: { get: m.get } }));
vi.mock('@/lib/db', () => ({
    prisma: {
        systemSetting: { findUnique: vi.fn(async () => ({ value: 'true' })) },
        customHeader: { findMany: vi.fn(async () => [{ id: 'h1', key: 'CF-Access-Token', value: 'real-token' }]) },
    },
}));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => ({ user: { role: 'ADMIN' } })) }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('@/lib/logger', () => ({ Logger: { log: vi.fn() } }));

import { POST } from '@/app/api/admin/prowlarr/indexers/route';

describe('POST /api/admin/prowlarr/indexers', () => {
    it('unmasks a saved custom header before calling Prowlarr', async () => {
        m.get.mockResolvedValue({ data: [] });
        const req = new Request('http://localhost/api/admin/prowlarr/indexers', {
            method: 'POST',
            body: JSON.stringify({ url: 'http://prowlarr:9696', apiKey: 'k', headers: [{ id: 'h1', key: 'CF-Access-Token', value: '********' }] }),
        });
        await POST(req);
        expect(m.get.mock.calls[0][1].headers['CF-Access-Token']).toBe('real-token');
    });
});
