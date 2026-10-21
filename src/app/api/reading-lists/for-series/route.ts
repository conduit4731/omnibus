// Fork only: which reading lists (events, reading orders, characters) a series appears in, and per issue
// which events / reading orders it belongs to - for the series page, like Batcave's "Event: The New 52".
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { listMeta } from '@/lib/reading-list-meta';
import { displayListName } from '@/lib/reading-list-groups';

export const dynamic = 'force-dynamic';

// Shown as chips on single issues; character lists are too broad for that and only appear in the summary
const ISSUE_CHIP_CATEGORIES = new Set(['Events', 'Master Reading Order']);

export async function GET(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const seriesId = new URL(request.url).searchParams.get('seriesId');
    if (!seriesId) return NextResponse.json({ error: 'Missing seriesId' }, { status: 400 });

    const issues = await prisma.issue.findMany({ where: { seriesId }, select: { id: true, metadataId: true } });
    const byCv = new Map(issues.filter(i => /^\d+$/.test(i.metadataId || '')).map(i => [Number(i.metadataId), i.id]));
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

    const byIssue: Record<string, { id: string, name: string }[]> = {};
    // Events first on the chips (the specific story), then the long reading orders
    for (const l of [...result].sort((a, b) => Number(b.category === 'Events') - Number(a.category === 'Events'))) {
        if (!ISSUE_CHIP_CATEGORIES.has(l.category)) continue;
        for (const issueId of l.issueIds) (byIssue[issueId] ||= []).push({ id: l.id, name: l.name });
    }
    return NextResponse.json({ lists: result.map(({ issueIds: _ids, ...l }) => l), byIssue });
}
