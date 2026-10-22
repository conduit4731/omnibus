// Fork only: the library folder of a provider series (ComicVine / Metron id), so the search can open it — owned or
// just subscribed (no files yet). { path: null } when the series isn't in the library.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const series = await prisma.series.findFirst({ where: { metadataId: id, folderPath: { not: '' } }, select: { folderPath: true } });
    return NextResponse.json({ path: series?.folderPath || null });
}
