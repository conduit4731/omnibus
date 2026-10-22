// Fork only: which reading lists (events, reading orders, characters) a series appears in, and per issue
// chips like Batcave's "Event: The New 52": the issue's era ("New 52", from its year and the publisher) and its events.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { listMeta } from '@/lib/reading-list-meta';
import { displayListName, namedEra, normalizePublisher } from '@/lib/reading-list-groups';

export const dynamic = 'force-dynamic';

type Chip = { name: string, href: string, kind: 'era' | 'event' };

export async function GET(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const seriesId = new URL(request.url).searchParams.get('seriesId');
    if (!seriesId) return NextResponse.json({ error: 'Missing seriesId' }, { status: 400 });

    const [series, issues] = await Promise.all([
        prisma.series.findUnique({ where: { id: seriesId }, select: { publisher: true, year: true } }),
        prisma.issue.findMany({ where: { seriesId }, select: { id: true, metadataId: true, metadataSource: true, releaseDate: true } }),
    ]);
    // Only ComicVine ids: an issue the calendar created carries a Metron id, which could equal an unrelated CV id
    const byCv = new Map(issues.filter(i => i.metadataSource === 'COMICVINE' && /^\d+$/.test(i.metadataId || '')).map(i => [Number(i.metadataId), i.id]));
    const items = await prisma.readingListItem.findMany({
        where: {
            OR: [{ issueId: { in: issues.map(i => i.id) } }, { cvIssueId: { in: [...byCv.keys()] } }],
            list: { OR: [{ userId }, { isGlobal: true }, { userId: null }] },
        },
        select: { listId: true, issueId: true, cvIssueId: true, list: { select: { id: true, name: true, description: true, updatedAt: true } } },
    });

    const ownIds = new Set(issues.map(i => i.id));
    const lists = new Map<string, { id: string, name: string, description: string | null, updatedAt: Date, issues: Set<string> }>();
    for (const it of items) {
        const issueId = it.issueId && ownIds.has(it.issueId) ? it.issueId : (it.cvIssueId ? byCv.get(it.cvIssueId) : undefined);
        if (!issueId) continue;
        const l = lists.get(it.listId) || { ...it.list, issues: new Set<string>() };
        l.issues.add(issueId);
        lists.set(it.listId, l);
    }
    const meta = await listMeta([...lists.values()]);
    const result = [...lists.values()].map(l => ({
        id: l.id, name: displayListName(l.name), category: meta.get(l.id)?.category || 'Lists', issueCount: l.issues.size, issueIds: [...l.issues],
    })).sort((a, b) => b.issueCount - a.issueCount || a.name.localeCompare(b.name));

    // Era first (every issue has one), then its events; reading orders and character lists only in the summary
    const byIssue: Record<string, Chip[]> = {};
    const publisher = normalizePublisher(series?.publisher);
    for (const i of issues) {
        const year = parseInt(i.releaseDate?.slice(0, 4) || '', 10) || series?.year || null;
        const era = namedEra(publisher, year, parseInt(i.releaseDate?.slice(5, 7) || '', 10) || undefined);
        if (era) byIssue[i.id] = [{ name: era, kind: 'era', href: `/events?publisher=${encodeURIComponent(publisher!)}&era=${encodeURIComponent(era)}` }];
    }
    for (const l of result) {
        if (l.category !== 'Events') continue;
        for (const issueId of l.issueIds) (byIssue[issueId] ||= []).push({ name: l.name, kind: 'event', href: `/reading-lists?id=${l.id}` });
    }
    return NextResponse.json({ lists: result.map(({ issueIds: _ids, ...l }) => l), byIssue });
}
