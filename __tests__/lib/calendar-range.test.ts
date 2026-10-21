import { describe, it, expect } from 'vitest';
import { chunks, daysBetween, parseDay, rangeFor, shift } from '@/lib/calendar-range';

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

    it('cuts a range into pieces the global endpoint accepts', () => {
        expect(chunks('2026-09-28', '2026-11-08', 42)).toEqual([{ from: '2026-09-28', to: '2026-11-08' }]);   // a month view: one call
        expect(chunks('2026-10-01', '2026-10-10', 4)).toEqual([
            { from: '2026-10-01', to: '2026-10-04' }, { from: '2026-10-05', to: '2026-10-08' }, { from: '2026-10-09', to: '2026-10-10' }]);
        expect(chunks('2026-10-21', '2026-10-21', 42)).toEqual([{ from: '2026-10-21', to: '2026-10-21' }]);
    });

    it('lists the days of a range', () => {
        expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    });
});
