// __tests__/lib/batcave.test.ts
import { describe, it, expect } from 'vitest';
import { normIssueNumber, parseBatcaveTitle, pickSeries, uploadFileName } from '@/lib/batcave';

describe('lib/batcave', () => {
    it('parses Batcave series titles', () => {
        expect(parseBatcaveTitle('New Avengers: Illuminati (2007)')).toEqual({ name: 'New Avengers: Illuminati', year: 2007 });
        expect(parseBatcaveTitle('Secret Invasion Prologue (2008-)')).toEqual({ name: 'Secret Invasion Prologue', year: 2008 });
        expect(parseBatcaveTitle('Action Comics (2011-2016) (New 52)')).toEqual({ name: 'Action Comics', year: 2011 });
        expect(parseBatcaveTitle('No year')).toBeNull();
    });

    it('matches names loosely and years within one, closest first', () => {
        const rows = [
            { id: 'a', name: 'Flash', year: 1987, folderPath: '' },
            { id: 'b', name: 'The Flash', year: 2011, folderPath: '' },
            { id: 'c', name: 'The Flash', year: 2010, folderPath: '' },
            { id: 'd', name: 'New Avengers - Illuminati', year: 2007, folderPath: '' },
        ];
        expect(pickSeries(rows, 'The Flash (2010)')?.id).toBe('c');
        expect(pickSeries(rows, 'Flash (2011)')?.id).toBe('b');
        expect(pickSeries(rows, 'New Avengers: Illuminati (2007)')?.id).toBe('d');
        expect(pickSeries(rows, 'The Flash (2016)')).toBeNull();
        // no year on Batcave: only a unique name
        expect(pickSeries(rows, 'New Avengers: Illuminati')?.id).toBe('d');
        expect(pickSeries(rows, 'The Flash')).toBeNull();
        expect(pickSeries(rows, '')).toBeNull();
    });

    it('normalises issue numbers', () => {
        expect(normIssueNumber('001')).toBe('1');
        expect(normIssueNumber('23.10')).toBe('23.1');
        expect(normIssueNumber(' 0 ')).toBe('0');
        expect(normIssueNumber('½')).toBe('½');
    });

    it('builds names batcave-import.sh parses', () => {
        expect(uploadFileName('Batman/Superman', 2013, '007', false)).toBe('BatmanSuperman_(2013)_Issue_#7.cbz');
        expect(uploadFileName('New Avengers: Illuminati', 2007, '1', true)).toBe('New_Avengers_Illuminati_(2007)_Annual_#1.cbz');
        expect(uploadFileName('Justice League', 2011, '23.1', false)).toBe('Justice_League_(2011)_Issue_#23.1.cbz');
    });
});
