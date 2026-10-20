import { describe, it, expect } from 'vitest';
import { classifyList, eraFor, medianYear, normalizePublisher, yearFromTitle } from '@/lib/reading-list-groups';

describe('reading list grouping (fork)', () => {
    it('normalizes publisher names', () => {
        expect(normalizePublisher('DC Comics')).toBe('DC');
        expect(normalizePublisher('Marvel')).toBe('Marvel');
        expect(normalizePublisher('Image Comics')).toBe('Image');
        expect(normalizePublisher('Unknown')).toBeNull();
        expect(normalizePublisher(null)).toBeNull();
    });

    it('maps years to named eras, decades for other publishers', () => {
        expect(eraFor('DC', 2011)).toEqual({ era: 'New 52', eraStart: 2011 });
        expect(eraFor('DC', 2015)).toEqual({ era: 'New 52', eraStart: 2011 });
        expect(eraFor('DC', 2016)).toEqual({ era: 'Rebirth', eraStart: 2016 });
        expect(eraFor('DC', 1940)).toEqual({ era: 'Golden Age', eraStart: 0 });
        expect(eraFor('Marvel', 1963)).toEqual({ era: 'Silver Age', eraStart: 1956 });
        expect(eraFor('Image', 1997)).toEqual({ era: '1990s', eraStart: 1990 });
        expect(eraFor('DC', null)).toEqual({ era: 'Unknown era', eraStart: 9999 });
    });

    it('takes the median year and reads years from titles', () => {
        expect(medianYear([2011, 1940, 2012])).toBe(2011);
        expect(medianYear([])).toBeNull();
        expect(yearFromTitle('Batman (2011) #24')).toBe(2011);
        expect(yearFromTitle('Batman #24')).toBeNull();
    });

    it('classifies by repo path first, then linked series, then a [Publisher] name prefix', () => {
        expect(classifyList({ name: 'Zero Year', description: 'comics-ro: DC/Events/CBRO/2011-2015 - New 52/x.cbl' }, ['Marvel']))
            .toEqual({ publisher: 'DC', category: 'Events' });
        expect(classifyList({ name: 'My list' }, ['Marvel', 'DC Comics', 'DC Comics', null]))
            .toEqual({ publisher: 'DC', category: 'Lists' });
        expect(classifyList({ name: '[Marvel] Civil War' }, [null])).toEqual({ publisher: 'Marvel', category: 'Lists' });
        expect(classifyList({ name: 'Mixed bag' }, [])).toEqual({ publisher: 'Other', category: 'Lists' });
    });
});
