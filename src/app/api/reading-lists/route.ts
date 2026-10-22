// src/app/api/reading-lists/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { getErrorMessage } from '@/lib/utils/error';
import { Logger } from '@/lib/logger';
import { getAccessibleLibraryIds } from '@/lib/library-access';
import { listMeta } from '@/lib/reading-list-meta';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const authOptions = await getAuthOptions();
        const session = await getServerSession(authOptions);
        const userId = (session?.user as any)?.id;

        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Per-library access: hide list items whose linked issue is in a library the user can't access.
        // Metadata-only items (no linked issue yet) are kept — they're reading-order placeholders, not content.
        const accessibleLibs = await getAccessibleLibraryIds(userId, (session?.user as any)?.role);
        const itemAccessWhere = accessibleLibs === 'ALL'
            ? {}
            : { OR: [{ issueId: null }, { issue: { series: { libraryId: { in: accessibleLibs } } } }] };

        const visible = { OR: [ { userId: userId }, { isGlobal: true }, { userId: null } ] };
        const listId = new URL(request.url).searchParams.get('id');

        // Overview (no ?id): names + counts only. Loading every item of every list made the page unusable
        // with a few hundred imported CBL lists (#252); items come per list via ?id=.
        if (!listId) {
            const lists = await prisma.readingList.findMany({
                where: visible,
                include: { user: { select: { username: true } } }, // Important for the UI to display the creator of Global lists
                orderBy: { updatedAt: 'desc' }
            });
            // Counts in the database (one grouped query each) instead of loading every item (#252)
            const ids = lists.map(l => l.id);
            const completedIds = (await prisma.readProgress.findMany({
                where: { userId, isCompleted: true }, select: { issueId: true }
            })).map(p => p.issueId);
            const count = (where: object) => prisma.readingListItem.groupBy({
                by: ['listId'], where: { listId: { in: ids }, ...itemAccessWhere, ...where }, _count: { _all: true },
            }).then(rows => new Map(rows.map(r => [r.listId, r._count._all])));
            const [items, owned, read] = await Promise.all([
                count({}),
                count({ issue: { filePath: { not: null } } }),
                completedIds.length ? count({ issueId: { in: completedIds } }) : Promise.resolve(new Map<string, number>()),
            ]);
            // Publisher, era and covers for the picker / Events / Characters pages (fork)
            const meta = await listMeta(lists);
            return NextResponse.json(lists.map(l => ({
                ...l, itemCount: items.get(l.id) || 0, ownedCount: owned.get(l.id) || 0, readCount: read.get(l.id) || 0, ...meta.get(l.id),
            })));
        }

        const loadList = () => prisma.readingList.findFirst({
            where: { id: listId, ...visible },
            include: {
                user: { select: { username: true } },
                items: {
                    where: itemAccessWhere,
                    orderBy: { order: 'asc' },
                    // Only what the list page uses: full Series rows made a 688-entry list 5.5 MB (fork)
                    include: { issue: { select: {
                        id: true, number: true, name: true, filePath: true, coverUrl: true, isAnnual: true, seriesId: true, releaseDate: true,
                        series: { select: { id: true, name: true, folderPath: true, metadataId: true, metadataSource: true, year: true, publisher: true, status: true } },
                    } } }
                }
            }
        });
        let list = await loadList();
        if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Auto-link logic: Find items that were imported from a CSV or Auto-builder that have a Metadata ID but no local database linkage yet
        const unlinked = list.items.filter(item => !item.issueId && item.cvIssueId);
        if (unlinked.length > 0) {
            const bySource = new Map<string, string[]>();
            for (const item of unlinked) {
                const source = item.metadataSource || 'COMICVINE';
                bySource.set(source, [...(bySource.get(source) || []), item.cvIssueId!.toString()]);
            }
            const potentialIssues = await prisma.issue.findMany({
                where: { OR: [...bySource].map(([source, ids]) => ({ metadataSource: source, metadataId: { in: ids } })) },
                select: { id: true, metadataId: true, metadataSource: true }
            });
            const linkUpdates = [];
            for (const item of unlinked) {
                const validIssue = potentialIssues.find(i => i.metadataId === item.cvIssueId!.toString() && i.metadataSource === (item.metadataSource || 'COMICVINE'));
                if (validIssue) {
                    linkUpdates.push(prisma.readingListItem.update({ where: { id: item.id }, data: { issueId: validIssue.id } }));
                }
            }
            if (linkUpdates.length > 0) {
                await prisma.$transaction(linkUpdates);
                list = (await loadList())!;
            }
        }

        // The user's progress per linked issue, so the list can show read / in progress / unread (#253)
        const progress = await prisma.readProgress.findMany({
            where: { userId, issueId: { in: list.items.flatMap(i => i.issueId ? [i.issueId] : []) } },
            select: { issueId: true, currentPage: true, totalPages: true, isCompleted: true }
        });
        const progressByIssue = new Map(progress.map(p => [p.issueId, p]));

        // Fork: per series of the list, like the library: issues on disk and issues released so far
        const seriesIds = [...new Set(list.items.flatMap(i => i.issue?.seriesId ? [i.issue.seriesId] : []))];
        const today = new Date().toISOString().slice(0, 10);
        const [ownedBy, releasedBy] = seriesIds.length ? await Promise.all([
            prisma.issue.groupBy({ by: ['seriesId'], where: { seriesId: { in: seriesIds }, filePath: { not: null } }, _count: { _all: true } }),
            prisma.issue.groupBy({ by: ['seriesId'], where: { seriesId: { in: seriesIds }, OR: [{ releaseDate: null }, { releaseDate: { lte: today } }] }, _count: { _all: true } }),
        ]) : [[], []];
        const seriesStats: Record<string, { owned: number, released: number }> = {};
        for (const id of seriesIds) seriesStats[id] = {
            owned: ownedBy.find(g => g.seriesId === id)?._count._all || 0,
            released: releasedBy.find(g => g.seriesId === id)?._count._all || 0,
        };

        return NextResponse.json({
            ...list,
            items: list.items.map(item => ({ ...item, progress: (item.issueId && progressByIssue.get(item.issueId)) || null })),
            seriesStats
        });
    } catch (error: unknown) {
        Logger.log(`[Reading Lists API] Error: ${getErrorMessage(error)}`, 'error');
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const authOptions = await getAuthOptions();
        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        
        const userId = (session.user as any).id;
        const { name, description, isGlobal, coverUrl } = await request.json();

        if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

        // Ensure only admins can set the global flag
        const isAdmin = (session.user as any).role === 'ADMIN';

        const canMakeGlobal = (session.user as any).role === 'ADMIN' || (session.user as any).canCreateGlobalLists === true;

        const newList = await prisma.readingList.create({
            data: {
                name,
                description,
                coverUrl,
                isGlobal: isGlobal === true && canMakeGlobal,
                userId: userId // Always preserve the creator's ID
            }
        });

        // Provide both id and listId for unified compatibility with the Library page creation flow
        return NextResponse.json({ success: true, id: newList.id, listId: newList.id, list: newList });
    } catch (error: unknown) {
        Logger.log(`[Reading Lists API] Error: ${getErrorMessage(error)}`, 'error');
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const authOptions = await getAuthOptions();
        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

        const list = await prisma.readingList.findUnique({ where: { id } });
        if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (list.userId !== (session.user as any).id && (session.user as any).role !== 'ADMIN') {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Clean up items before deleting the list
        await prisma.readingListItem.deleteMany({ where: { listId: id } });
        await prisma.readingList.delete({ where: { id } });
        
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        Logger.log(`[Reading Lists API] Error: ${getErrorMessage(error)}`, 'error');
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}