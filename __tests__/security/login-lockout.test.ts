// Password sign-in lockout: 5 failures lock the username for that IP only, so a stranger cannot lock the admin out
// with 5 wrong passwords; 50 failures from anywhere still lock the username for everyone.
vi.unmock('@/app/api/auth/[...nextauth]/options');
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    process.env.NEXTAUTH_SECRET = 'super_secure_test_secret_key_1234567890';
    return { compare: vi.fn() };
});

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';

vi.mock('@/lib/db', () => ({
    prisma: {
        systemSetting: { findMany: vi.fn(async () => []) },
        $queryRaw: vi.fn(async () => [{
            id: 'admin_1', username: 'admin', email: 'admin@home.lan', role: 'ADMIN', password: '$2a$10$hash',
            isApproved: true, twoFactorEnabled: false, twoFactorSecret: null, avatar: null, sessionVersion: 0,
        }]),
    },
}));
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }));
vi.mock('@/lib/encryption', () => ({ decrypt2FA: vi.fn() }));

const signIn = async (ip: string, password: string) => {
    const o = await getAuthOptions();
    const credentials = o.providers.find((p: any) => p.id === 'credentials') as any;
    mocks.compare.mockResolvedValue(password === 'right');
    return credentials.options.authorize({ username: 'admin', password }, { headers: { 'x-forwarded-for': ip } });
};

describe('login lockout', () => {
    it("5 wrong passwords from one IP lock only that IP, the admin's own IP still signs in", async () => {
        for (let i = 0; i < 5; i++) await expect(signIn('10.0.0.66', 'wrong')).rejects.toThrow('Invalid username or password');
        await expect(signIn('10.0.0.66', 'right')).rejects.toThrow('Account locked');
        await expect(signIn('10.0.0.2', 'right')).resolves.toMatchObject({ id: 'admin_1' });
    });

    it('50 failures across forged IPs lock the username for everyone', async () => {
        for (let i = 0; i < 50; i++) await expect(signIn(`192.0.2.${i}`, 'wrong')).rejects.toThrow('Invalid username or password');
        await expect(signIn('10.0.0.3', 'right')).rejects.toThrow('Account locked');
    });
});
