// __tests__/lib/session-timeout.test.ts
//
// Shared inactivity-window rules used by BOTH the NextAuth jwt callback and the middleware.
// Admins get a deliberately shorter window (2h) than regular users (6h).
import { describe, it, expect } from 'vitest';
import { ADMIN_TIMEOUT_MS, USER_TIMEOUT_MS, REMEMBER_TIMEOUT_MS, isInactivityExpired, windowRole } from '@/lib/session-timeout';

const HOUR = 60 * 60 * 1000;

describe('lib/session-timeout', () => {
    it('defines a 2h admin window and a 6h user window', () => {
        expect(ADMIN_TIMEOUT_MS).toBe(2 * HOUR);
        expect(USER_TIMEOUT_MS).toBe(6 * HOUR);
    });

    it('expires an admin idle for more than 2 hours', () => {
        const now = 10 * HOUR;
        expect(isInactivityExpired('ADMIN', now - 2 * HOUR - 1, now)).toBe(true);
        expect(isInactivityExpired('ADMIN', now - 2 * HOUR + 1000, now)).toBe(false);
    });

    it('gives non-admins the 6 hour window', () => {
        const now = 10 * HOUR;
        expect(isInactivityExpired('USER', now - 3 * HOUR, now)).toBe(false);
        expect(isInactivityExpired('USER', now - 6 * HOUR - 1, now)).toBe(true);
        // Unknown/missing role falls back to the longer user window, matching the jwt callback.
        expect(isInactivityExpired(undefined, now - 3 * HOUR, now)).toBe(false);
    });

    it('never expires a token that has no lastActive stamp', () => {
        expect(isInactivityExpired('ADMIN', undefined, 10 * HOUR)).toBe(false);
        expect(isInactivityExpired('ADMIN', null, 10 * HOUR)).toBe(false);
        expect(isInactivityExpired('ADMIN', 0, 10 * HOUR)).toBe(false);
    });

    it('gives a "keep me logged in" session 30 days, but not while impersonating', () => {
        const now = 100 * 24 * HOUR;
        expect(REMEMBER_TIMEOUT_MS).toBe(30 * 24 * HOUR);
        const role = windowRole({ role: 'ADMIN', remember: true });
        expect(isInactivityExpired(role, now - 7 * 24 * HOUR, now)).toBe(false);
        expect(isInactivityExpired(role, now - 30 * 24 * HOUR - 1, now)).toBe(true);
        expect(windowRole({ role: 'USER', remember: true, isImpersonating: true })).toBe('ADMIN');
        expect(windowRole({ role: 'ADMIN', remember: false })).toBe('ADMIN');
    });
});
