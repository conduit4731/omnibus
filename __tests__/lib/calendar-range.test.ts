import { describe, it, expect } from 'vitest';
import { daysBetween, globalWeekOffsets, parseDay, rangeFor, shift } from '@/lib/calendar-range';

const d = parseDay;

describe('calendar ranges (fork)', () => {
    it('day, week (Monday start), month (whole weeks) and year', () => {
        expect(rangeFor('day', d('2026-10-21'))).toEqual({ from: '2026-10-21', to: '2026-10-21' });
        expect(rangeFor('week', d('2026-10-21'))).toEqual({ from: '2026-10-19', to: '2026-10-25' });   // Wed -> Mon..Sun
        expect(rangeFor('week', d('2026-10-25'))).toEqual({ from: '2026-10-19', to: '2026-10-25' });   // Sunday stays in its week
        expect(rangeFor('month', d('2026-10-21'))).toEqual({ from: '2026-09-28', to: '2026-11-01' });
        expect(rangeFor('year', d('2026-10-21'))).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    });

    it('steps by the view unit, months without day overflow', () => {
        expect(shift('week', d('2026-10-21'), 1).toISOString().slice(0, 10)).toBe('2026-10-28');
        expect(shift('month', d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-01');
        expect(shift('year', d('2026-10-21'), -1).toISOString().slice(0, 10)).toBe('2025-10-01');
    });

    it('maps a range to the global endpoint\'s Sunday weeks relative to today', () => {
        // today Wed 2026-10-21 -> its week starts Sun 2026-10-18 = offset 0
        expect(globalWeekOffsets('2026-10-19', '2026-10-25', d('2026-10-21'))).toEqual([0, 1]);   // Mon..Sun touches two Sunday weeks
        expect(globalWeekOffsets('2026-10-11', '2026-10-17', d('2026-10-21'))).toEqual([-1]);
    });

    it('lists the days of a range', () => {
        expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    });
});
