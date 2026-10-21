// Fork only: library insights for the library page. One pass over every issue row (a few thousand: cheap).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { buildInsights, type IssueRow } from '@/lib/library-insights';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await getServerSession(await getAuthOptions());
    const userId = (session?.user as any)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [issues, done] = await Promise.all([
        prisma.issue.findMany({
            select: { id: true, seriesId: true, filePath: true, releaseDate: true, fileAddedAt: true,
                      series: { select: { name: true, year: true, folderPath: true, publisher: true, metadataId: true, status: true } } },
        }),
        prisma.readProgress.findMany({ where: { userId, isCompleted: true }, select: { issueId: true } }),
    ]);
    const readIds = new Set(done.map(d => d.issueId));
    return NextResponse.json(buildInsights(issues.map(({ id, ...i }) => ({ ...i, read: readIds.has(id) })) as IssueRow[]));
}
