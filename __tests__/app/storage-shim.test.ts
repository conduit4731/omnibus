import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Fork: the inline <head> script in layout.tsx that stands in for blocked web storage (Brave on iOS)
const layout = fs.readFileSync(path.join(__dirname, '../../src/app/layout.tsx'), 'utf8');
const shim = layout.match(/\['localStorage', 'sessionStorage'\][\s\S]*?\}\);\n/)![0];
const run = (win: object) => new Function('window', shim)(win);

describe('web storage shim (fork)', () => {
    it('replaces a null or throwing storage with an in-memory one', () => {
        const win: any = {};
        Object.defineProperty(win, 'localStorage', { get: () => null, configurable: true });
        Object.defineProperty(win, 'sessionStorage', { get: () => { throw new Error('SecurityError'); }, configurable: true });
        run(win);
        win.localStorage.setItem('a', 1);
        expect(win.localStorage.getItem('a')).toBe('1');
        expect(win.localStorage.getItem('missing')).toBeNull();
        win.sessionStorage.setItem('b', 'x');
        expect(win.sessionStorage.length).toBe(1);
    });

    it('leaves working storage alone', () => {
        const s: Record<string, string> = {};
        const real = { setItem: (k: string, v: string) => { s[k] = v }, removeItem: (k: string) => { delete s[k] }, getItem: (k: string) => s[k] ?? null };
        const win: any = { localStorage: real, sessionStorage: real };
        run(win);
        expect(win.localStorage).toBe(real);
    });
});
