import { describe, it, expect } from 'vitest';
import { chronological, eventStatus } from '@/components/event-timeline';

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
});
