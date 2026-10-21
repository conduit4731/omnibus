import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn() }));
vi.mock('@/lib/metadata/metadata-cache', () => ({ cachedCvGet: vi.fn() }));

import { pickPortrait } from '@/lib/reading-list-groups';

const r = (name: string, publisher: string | null, url: string) => ({ name, publisher: publisher ? { name: publisher } : null, image: { medium_url: url } });

describe('pickPortrait (fork)', () => {
    it('prefers the exact name from the right publisher', () => {
        const results = [r('Batman Beyond', 'DC Comics', 'beyond'), r('Batman', 'Marvel', 'wrong'), r('Batman', 'DC Comics', 'bruce')];
        expect(pickPortrait(results, 'Batman', 'DC')).toBe('bruce');
    });
    it('falls back to the first result of the publisher, and accepts results without one', () => {
        expect(pickPortrait([r('Barbara Gordon', 'DC Comics', 'babs')], 'Batgirl', 'DC')).toBe('babs');
        expect(pickPortrait([r('Batgirl', null, 'x')], 'Batgirl', 'DC')).toBe('x');
    });
    it('returns null when nothing fits', () => {
        expect(pickPortrait([r('Batgirl', 'Marvel', 'x')], 'Batgirl', 'DC')).toBeNull();
        expect(pickPortrait([], 'Batgirl', 'DC')).toBeNull();
    });
});
