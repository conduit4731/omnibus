// Fork only: how long the user read, per day, per series and per reading list (from DailyIssueRead.secondsRead).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { displayListName } from '@/lib/reading-list-groups';

export const dynamic = 'force-dynamic';

const TOP = 15;

export async function GET(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // days=0: everything
    const days = Math.max(0, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 0);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - days + 1);

    const reads = await prisma.dailyIssueRead.findMany({
        where: { userId, secondsRead: { gt: 0 }, ...(days ? { date: { gte: from } } : {}) },
        select: { date: true, secondsRead: true, pagesRead: true, issueId: true,
                  issue: { select: { seriesId: true, series: { select: { name: true, year: true, folderPath: true } } } } },
    });

    const daily = new Map<string, number>();
    const series = new Map<string, { id: string, name: string, year: number | null, path: string | null, seconds: number, pages: number, issues: Set<string> }>();
    const perIssue = new Map<string, number>();
    let totalSeconds = 0;
    for (const r of reads) {
        totalSeconds += r.secondsRead;
        const day = r.date.toISOString().slice(0, 10);
        daily.set(day, (daily.get(day) || 0) + r.secondsRead);
        perIssue.set(r.issueId, (perIssue.get(r.issueId) || 0) + r.secondsRead);
        const s = r.issue?.series;
        if (!s || !r.issue) continue;
        const e = series.get(r.issue.seriesId) || { id: r.issue.seriesId, name: s.name, year: s.year, path: s.folderPath, seconds: 0, pages: 0, issues: new Set<string>() };
        e.seconds += r.secondsRead; e.pages += r.pagesRead; e.issues.add(r.issueId);
        series.set(r.issue.seriesId, e);
    }

    // An issue in several lists (an event and a character's reading order) counts for each of them
    const items = perIssue.size ? await prisma.readingListItem.findMany({
        where: { issueId: { in: [...perIssue.keys()] }, list: { OR: [{ userId }, { isGlobal: true }, { userId: null }] } },
        select: { issueId: true, listId: true, list: { select: { name: true } } },
    }) : [];
    const lists = new Map<string, { id: string, name: string, seconds: number, issues: Set<string> }>();
    for (const it of items) {
        if (!it.issueId) continue;
        const e = lists.get(it.listId) || { id: it.listId, name: displayListName(it.list.name), seconds: 0, issues: new Set<string>() };
        if (!e.issues.has(it.issueId)) { e.issues.add(it.issueId); e.seconds += perIssue.get(it.issueId) || 0; }
        lists.set(it.listId, e);
    }

    const top = <T extends { seconds: number, issues: Set<string> }>(m: Map<string, T>) =>
        [...m.values()].sort((a, b) => b.seconds - a.seconds).slice(0, TOP).map(({ issues, ...e }) => ({ ...e, issues: issues.size }));
    return NextResponse.json({
        totalSeconds,
        daily: [...daily.entries()].sort().map(([date, seconds]) => ({ date, seconds })),
        series: top(series),
        lists: top(lists),
    });
}
