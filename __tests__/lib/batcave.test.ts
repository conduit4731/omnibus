// __tests__/lib/batcave.test.ts
import { describe, it, expect } from 'vitest';
import { eventKey, normIssueNumber, sameEvent, parseBatcaveTitle, pickCvVolume, pickSeries, uploadFileName } from '@/lib/batcave';

describe('lib/batcave', () => {
    it('matches a Batcave event title to the reading list name', () => {
        expect(eventKey('Knight Terrors Reading Order')).toBe(eventKey('[DC] Knight Terrors (2023)'));
        expect(eventKey('Knight Terrors')).toBe('knightterrors');
        expect(eventKey('Dark Nights: Metal')).not.toBe(eventKey('Dark Nights: Death Metal'));
        expect(sameEvent('Secret Wars (2015)', '[Marvel] Secret Wars (2015)')).toBe(true);
        expect(sameEvent('Secret Wars (2015)', 'Secret Wars (1984)')).toBe(false);
        expect(sameEvent('Dark Reign', 'Dark Reign (2008)')).toBe(true);
    });

    it('parses Batcave series titles', () => {
        expect(parseBatcaveTitle('New Avengers: Illuminati (2007)')).toEqual({ name: 'New Avengers: Illuminati', year: 2007 });
        expect(parseBatcaveTitle('Secret Invasion Prologue (2008-)')).toEqual({ name: 'Secret Invasion Prologue', year: 2008 });
        expect(parseBatcaveTitle('Action Comics (2011-2016) (New 52)')).toEqual({ name: 'Action Comics', year: 2011 });
        expect(parseBatcaveTitle('No year')).toBeNull();
    });

    it('matches names loosely, years exactly', () => {
        const rows = [
            { id: 'a', name: 'Flash', year: 1987, folderPath: '' },
            { id: 'b', name: 'The Flash', year: 2011, folderPath: '' },
            { id: 'c', name: 'The Flash', year: 2010, folderPath: '' },
            { id: 'd', name: 'New Avengers - Illuminati', year: 2007, folderPath: '' },
        ];
        expect(pickSeries(rows, 'The Flash (2010)')?.id).toBe('c');
        expect(pickSeries(rows, 'Flash (2011)')?.id).toBe('b');
        // vol. 3 is not New 52: no ±1
        expect(pickSeries([rows[1]], 'The Flash (2010)')).toBeNull();
        expect(pickSeries(rows, 'New Avengers: Illuminati (2007)')?.id).toBe('d');
        expect(pickSeries(rows, 'The Flash (2016)')).toBeNull();
        // no year on Batcave: only a unique name
        expect(pickSeries(rows, 'New Avengers: Illuminati')?.id).toBe('d');
        expect(pickSeries(rows, 'The Flash')).toBeNull();
        expect(pickSeries(rows, '')).toBeNull();
    });

    it('picks the ComicVine volume for a Batcave title', () => {
        const cv = [
            { id: 1, name: 'Flashpoint', start_year: '1999' },
            { id: 2, name: 'Flashpoint', start_year: '2011' },
            { id: 3, name: 'Absolute Superman', start_year: '2025' },
            { id: 4, name: 'Flashpoint: Reverse-Flash', start_year: '2011' },
            { id: 5, name: 'The Flash', start_year: '2010' },
            { id: 6, name: 'The Flash', start_year: '2011' },
        ];
        expect(pickCvVolume(cv, 'Flashpoint (2011)')?.id).toBe(2);
        expect(pickCvVolume(cv, 'Absolute Superman (2024-)')?.id).toBe(3);
        expect(pickCvVolume(cv, 'Flashpoint: Reverse-Flash')?.id).toBe(4);
        expect(pickCvVolume(cv, 'The Flash (2010)')?.id).toBe(5);
        expect(pickCvVolume(cv, 'Flashpoint')).toBeNull();          // two without a year, no issue counts: a tie
        expect(pickCvVolume(cv, 'Booster Gold (2007)')).toBeNull();
    });

    it('prefers the series over same-named trade paperbacks', () => {
        const cv = [
            { id: 10, name: 'JLA', start_year: '1997', count_of_issues: 1 },
            { id: 11, name: 'JLA', start_year: '1997', count_of_issues: 125 },
            { id: 12, name: 'JLA', start_year: '1997', count_of_issues: 1 },
            { id: 20, name: 'Green Lantern: Rebirth', start_year: '2004', count_of_issues: 6 },
            { id: 21, name: 'Green Lantern: Rebirth', start_year: '2016', count_of_issues: 1 },
            { id: 30, name: 'Rann-Thanagar War', start_year: '2005', count_of_issues: 6 },
        ];
        expect(pickCvVolume(cv, 'JLA (1997)')?.id).toBe(11);
        expect(pickCvVolume(cv, 'Green Lantern: Rebirth')?.id).toBe(20);
        expect(pickCvVolume(cv, 'Rann/Thanagar War (2005)')?.id).toBe(30);
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
