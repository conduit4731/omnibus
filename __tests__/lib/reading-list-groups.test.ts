import { describe, it, expect } from 'vitest';
import { classifyList, eraFor, medianYear, namedEra, normalizePublisher, starWarsEra, subjectOf, yearFromTitle } from '@/lib/reading-list-groups';

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
        expect(eraFor('DC', 2024)).toEqual({ era: 'Dawn of DC', eraStart: 2023 });   // Absolute Power (2024) is still Dawn of DC
        expect(eraFor('DC', 2025)).toEqual({ era: 'All In', eraStart: 2024 });
        expect(namedEra('DC', 2024, 10)).toBe('All In');        // Absolute Batman #1, October 2024
        expect(namedEra('DC', 2024, 9)).toBe('Dawn of DC');
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

    it('puts Star Wars on the Events page as its own publisher, Canon and Legends as eras', () => {
        for (const path of ['Marvel/Star Wars/[Marvel] Star Wars (WEB-CBRO).cbl', 'Dark Horse/Star Wars/[Dark Horse] Star Wars (WEB-CBRO).cbl', 'Other/Star Wars/CBRO/[Marvel] 001 The High Republic.cbl'])
            expect(classifyList({ name: 'x', description: `comics-ro: ${path}` }, ['Marvel'])).toEqual({ publisher: 'Star Wars', category: 'Events' });
        expect(starWarsEra('Star Wars Legends, Part 3: Rise of the Empire Era')).toEqual({ era: 'Legends (Dark Horse)', eraStart: 1991 });
        expect(starWarsEra('Star Wars Canon, Part 4.2: Vader Down').era).toBe('Canon (Marvel)');
    });

    it('reads the character from the repo path', () => {
        expect(subjectOf('comics-ro: DC/Characters/Batman/[DC] Batman - New 52.cbl')).toBe('Batman');
        expect(subjectOf('comics-ro: DC/Characters/unsorted/Batgirl/Batgirl 003.cbl')).toBe('Batgirl');
        expect(subjectOf('comics-ro: DC/Characters/Green Lantern/Reddit/GL 06.cbl')).toBe('Green Lantern');
        expect(subjectOf('comics-ro: DC/Events/CBRO/x.cbl')).toBeNull();
        expect(subjectOf('my own list')).toBeNull();
    });
});
