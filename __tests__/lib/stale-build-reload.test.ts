// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isStaleBuildError, reloadOnce } from '@/lib/stale-build-reload';

describe('stale build reload (fork)', () => {
    it('recognizes chunk load errors from webpack and browsers', () => {
        expect(isStaleBuildError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
        expect(isStaleBuildError(new Error('Loading chunk 4215 failed.'))).toBe(true);
        expect(isStaleBuildError(new Error('Loading CSS chunk app-layout failed'))).toBe(true);
        expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true);
        expect(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
        expect(isStaleBuildError(null)).toBe(false);
    });

    describe('reloadOnce', () => {
        const reload = vi.fn();
        beforeEach(() => {
            sessionStorage.clear();
            reload.mockClear();
            Object.defineProperty(window, 'location', { value: { reload }, configurable: true });
        });

        it('reloads once, then not again within 30 s', () => {
            expect(reloadOnce()).toBe(true);
            expect(reloadOnce()).toBe(false);
            expect(reload).toHaveBeenCalledTimes(1);
        });
    });
});
