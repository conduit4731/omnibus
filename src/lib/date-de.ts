// Fork: dates the German way (TT.MM.JJJJ). Release dates are calendar days ("YYYY-MM-DD"), read as UTC so no
// time zone shifts them by a day.
const day = (d: string | Date) => typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;

/** "2026-10-21" -> "21.10.2026" */
export const deDate = (d: string | Date) => day(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
/** "2026-10-21" -> "21.10." (inside a range whose year is shown once) */
export const deDayMonth = (d: string | Date) => day(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
/** "2026-10-21" -> "Mi., 21.10.2026" */
export const deWeekdayDate = (d: string | Date) => day(d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
/** "2026-10-21" -> "Oktober 2026" */
export const deMonthYear = (d: string | Date) => day(d).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
