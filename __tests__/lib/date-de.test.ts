import { describe, it, expect } from 'vitest';
import { deDate, deDayMonth, deMonthYear, deWeekdayDate } from '@/lib/date-de';

describe('German dates (fork)', () => {
    it('formats calendar days as TT.MM.JJJJ without time-zone shifts', () => {
        expect(deDate('2026-10-21')).toBe('21.10.2026');
        expect(deDate('2026-01-05T23:30:00')).toBe('05.01.2026');
        expect(deDayMonth('2026-10-19')).toBe('19.10.');
        expect(deWeekdayDate('2026-10-21')).toBe('Mi., 21.10.2026');
        expect(deMonthYear('2026-10-21')).toBe('Oktober 2026');
    });
});
