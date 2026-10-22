import { describe, it, expect } from 'vitest';
import { byEra, chronological, eventStatus } from '@/components/event-timeline';

describe('event timeline (fork)', () => {
    it('status: complete when everything is owned, else ongoing while issues come out this year or later', () => {
        expect(eventStatus({ itemCount: 10, ownedCount: 10, to: 2013 }, 2026)).toBe('Complete');
        expect(eventStatus({ itemCount: 100, ownedCount: 60, to: 2026 }, 2026)).toBe('Ongoing');
        expect(eventStatus({ itemCount: 13, ownedCount: 0, to: 2014 }, 2026)).toBe('Ended');
        expect(eventStatus({ itemCount: 5, ownedCount: 0, to: null }, 2026)).toBe('Ended');
    });

    it('sorts by first year, then last year, then name; lists without years last', () => {
        const l = (name: string, from: number | null, to: number | null) => ({ name, from, to });
        expect(chronological([l('Zero Year', 2013, 2014), l('Unknown', null, null), l('Night of the Owls', 2012, 2012), l('Death of the Family', 2012, 2013)]).map(x => x.name))
            .toEqual(['Night of the Owls', 'Death of the Family', 'Zero Year', 'Unknown']);
    });

    it('groups by era in era order, events chronological inside; shared era names form one group', () => {
        const l = (name: string, publisher: string, era: string, eraStart: number, from: number) => ({ name, publisher, era, eraStart, from, to: from });
        const g = byEra([l('Zero Year', 'DC', 'New 52', 2011, 2013), l('Kraven', 'Marvel', 'Bronze Age', 1970, 1987), l('Crisis', 'DC', 'Bronze Age', 1970, 1985),
                         l('Night of the Owls', 'DC', 'New 52', 2011, 2012), l('Secret Wars', 'Marvel', 'Modern Age', 1986, 1984)]);
        expect(g.map(x => [x.era, x.rows.map(r => r.name)])).toEqual([
            ['Bronze Age', ['Crisis', 'Kraven']], ['Modern Age', ['Secret Wars']], ['New 52', ['Night of the Owls', 'Zero Year']]]);
    });
});
