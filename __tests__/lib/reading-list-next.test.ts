import { describe, it, expect } from 'vitest';
import { nextInList } from '@/lib/reading-list-next';

const own = (id: string, read = false) => ({ id, issue: { filePath: `/c/${id}.cbz` }, progress: read ? { isCompleted: true } : null });
const miss = (id: string) => ({ id, issue: null, progress: null });
const ids = (xs: { id: string }[]) => xs.map(x => x.id);

describe('nextInList (fork)', () => {
    it('continues at the first unread owned entry', () => {
        const r = nextInList([own('a', true), own('b'), own('c')]);
        expect(r.item?.id).toBe('b');
        expect(r.index).toBe(1);
        expect(r.skipped).toEqual([]);
    });

    it('reports missing entries it jumps over', () => {
        const r = nextInList([own('a', true), miss('b'), miss('c'), own('d'), miss('e')]);
        expect(r.item?.id).toBe('d');
        expect(ids(r.skipped)).toEqual(['b', 'c']);
    });

    it('does not report gaps before the last read entry', () => {
        const r = nextInList([miss('x'), own('a', true), miss('y'), own('b')]);
        expect(ids(r.skipped)).toEqual(['y']);
        expect(r.item?.id).toBe('b');
    });

    it('reports gaps at the very start of an unread list', () => {
        expect(ids(nextInList([miss('x'), own('a')]).skipped)).toEqual(['x']);
    });

    it('returns no item when only missing entries are left', () => {
        const r = nextInList([own('a', true), miss('b')]);
        expect(r.item).toBeNull();
        expect(ids(r.skipped)).toEqual(['b']);
    });

    it('returns nothing for a finished list', () => {
        expect(nextInList([own('a', true)])).toEqual({ item: null, index: -1, skipped: [] });
    });
});
