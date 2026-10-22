import { describe, it, expect } from 'vitest';
import { findLocalSeriesMatch, normalizeSeriesName } from '@/lib/utils/series-match';

const lib = [
    { id: 'cw11', name: 'Catwoman', year: 2011 },
    { id: 'xm19', name: 'X-Men', year: 2019 }, { id: 'xm24', name: 'X-Men', year: 2024 },
    { id: 'saga', name: 'Saga', year: 0 },
];

describe('findLocalSeriesMatch', () => {
    it('fork: a single same-named volume from another era is not the release\'s series', () => {
        expect(findLocalSeriesMatch(lib, 'Catwoman', 2018)).toBeNull();
        expect(findLocalSeriesMatch(lib, 'Catwoman', 2011)?.id).toBe('cw11');
        expect(findLocalSeriesMatch(lib, 'Catwoman', 2012)?.id).toBe('cw11');   // ±1 across providers
        expect(findLocalSeriesMatch(lib, 'Catwoman', null)?.id).toBe('cw11');   // no release year: name decides
        expect(findLocalSeriesMatch(lib, 'Saga', 2012)?.id).toBe('saga');       // no local year: name decides
    });

    it('picks the same-named volume by year, none when no year fits', () => {
        expect(findLocalSeriesMatch(lib, 'X-Men: ', 2024)?.id).toBe('xm24');
        expect(findLocalSeriesMatch(lib, 'X-Men', 2020)?.id).toBe('xm19');
        expect(findLocalSeriesMatch(lib, 'X-Men', 2030)).toBeNull();
        expect(findLocalSeriesMatch(lib, 'Batman', 2011)).toBeNull();
    });

    it('compares names without punctuation', () => {
        expect(normalizeSeriesName('X-Men: Outback')).toBe(normalizeSeriesName('X-Men Outback'));
    });
});
