// src/lib/reading-stats.ts
import { prisma } from '@/lib/db';
import { Logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/utils/error';

// Fork: reading time = the gap since this issue's previous progress save, when it is short enough to be
// one sitting. A longer gap is a break and counts nothing.
// shortcut: the time on the last page before closing is never counted (no save follows it); fine for a few seconds per sitting.
export const IDLE_MS = 5 * 60 * 1000;
export function readingSeconds(lastActivity: Date | null | undefined, now = new Date()): number {
    if (!lastActivity) return 0;
    const gap = now.getTime() - new Date(lastActivity).getTime();
    return gap > 0 && gap <= IDLE_MS ? Math.round(gap / 1000) : 0;
}

// Records pages read today for the activity heatmap: the daily total plus which issue they came from,
// and (fork) the reading time since the previous progress save of that issue.
// Heatmap stats are auxiliary — a failure here is logged but never thrown, so it can't break progress saves.
export async function recordDailyReading(userId: string, issueId: string, pagesReadDelta: number, lastActivity?: Date | null): Promise<void> {
    const seconds = readingSeconds(lastActivity);
    pagesReadDelta = Math.max(0, pagesReadDelta);
    if (pagesReadDelta === 0 && seconds === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        await prisma.dailyReadingStat.upsert({
            where: { userId_date: { userId, date: today } },
            update: { pagesRead: { increment: pagesReadDelta } },
            create: { userId, date: today, pagesRead: pagesReadDelta }
        });

        await prisma.dailyIssueRead.upsert({
            where: { userId_issueId_date: { userId, issueId, date: today } },
            update: { pagesRead: { increment: pagesReadDelta }, secondsRead: { increment: seconds } },
            create: { userId, issueId, date: today, pagesRead: pagesReadDelta, secondsRead: seconds }
        });
    } catch (error) {
        Logger.log(`[Reading Stats] Failed to record daily reading for issue ${issueId}: ${getErrorMessage(error)}`, 'warn');
    }
}
