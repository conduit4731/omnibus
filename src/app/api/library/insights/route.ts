// Fork only: library insights for the library page. One pass over every issue row (a few thousand: cheap).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { buildInsights, type IssueRow } from '@/lib/library-insights';
import { promises as fs } from 'fs';

// Omnibus stores no file sizes: stat the files, and keep the answer for 10 minutes (a few thousand stats)
const SIZE_TTL_MS = 10 * 60 * 1000;
let sizeCache: { at: number, sizes: Map<string, number> } | null = null;
async function fileSizes(paths: string[]): Promise<Map<string, number>> {
    if (sizeCache && Date.now() - sizeCache.at < SIZE_TTL_MS && paths.every(p => sizeCache!.sizes.has(p))) return sizeCache.sizes;
    const sizes = new Map<string, number>();
    for (let i = 0; i < paths.length; i += 64) {
        await Promise.all(paths.slice(i, i + 64).map(p => fs.stat(p).then(st => sizes.set(p, st.size), () => sizes.set(p, 0))));
    }
    sizeCache = { at: Date.now(), sizes };
    return sizes;
}

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
    const sizes = await fileSizes(issues.flatMap(i => i.filePath ? [i.filePath] : []));
    return NextResponse.json(buildInsights(issues.map(({ id, ...i }) => ({ ...i, read: readIds.has(id), bytes: i.filePath ? sizes.get(i.filePath) : 0 })) as IssueRow[]));
}
