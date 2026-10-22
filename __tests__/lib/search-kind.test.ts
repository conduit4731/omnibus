import { describe, it, expect } from 'vitest';
import { searchKind } from '@/lib/search-kind';

describe('searchKind (fork)', () => {
    it('tells series, annuals, collected editions and one-shots apart', () => {
        expect(searchKind({ name: 'Detective Comics', count: 883, description: 'Detective Comics is a DC monthly ...' })).toBe('series');
        expect(searchKind({ name: 'Absolute Batman', count: 14 })).toBe('series');                     // "Absolute" is a line, not an edition
        expect(searchKind({ name: 'Batman Annual', count: 4 })).toBe('annual');
        expect(searchKind({ name: 'Batman: The Long Halloween', count: 1, description: 'Trade paperback collecting #1-13.' })).toBe('collected');
        expect(searchKind({ name: 'Batman Omnibus', count: 3 })).toBe('collected');
        expect(searchKind({ name: 'Batman: Detective', count: 1 })).toBe('one-shot');
        expect(searchKind({ name: 'New Series', count: 0 })).toBe('series');                           // count unknown yet
        expect(searchKind({ name: 'Saga', count: 66, description: 'x'.repeat(200) + ' collected in trade paperbacks' })).toBe('series');
    });
});
