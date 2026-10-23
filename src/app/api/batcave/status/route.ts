// src/app/api/batcave/status/route.ts
//
// Fork-only: the /batcave page (admin session).
//   GET  → counts per status, the open/failed jobs with their series, when the worker last asked for work.
//   POST { action: 'retry' | 'clearDone' | 'remove', ids? } — retry puts NOT_FOUND/ERROR (or the given ids) back to QUEUED.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function isAdmin() {
    const session = await getServerSession(await getAuthOptions());
    return (session?.user as { role?: string } | undefined)?.role === 'ADMIN';
}

export async function GET() {
    if (!(await isAdmin())) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    const counts = Object.fromEntries((await prisma.batcaveJob.groupBy({ by: ['status'], _count: true })).map(g => [g.status, g._count]));
    const jobs = await prisma.batcaveJob.findMany({ where: { status: { not: 'DONE' } }, orderBy: { createdAt: 'asc' }, take: 500 });
    const recent = await prisma.batcaveJob.findMany({ where: { status: 'DONE' }, orderBy: { updatedAt: 'desc' }, take: 30 });
    const series = new Map((await prisma.series.findMany({ where: { id: { in: [...new Set([...jobs, ...recent].map(j => j.seriesId))] } }, select: { id: true, name: true, year: true, folderPath: true } })).map(s => [s.id, s]));
    const shape = (j: typeof jobs[number]) => ({ id: j.id, seriesId: j.seriesId, series: series.get(j.seriesId) ? `${series.get(j.seriesId)!.name} (${series.get(j.seriesId)!.year})` : '?', seriesPath: series.get(j.seriesId)?.folderPath || null, number: j.number, isAnnual: j.isAnnual, status: j.status, message: j.message, updatedAt: j.updatedAt });
    const seen = await prisma.systemSetting.findUnique({ where: { key: 'batcave_worker_seen' } });
    return NextResponse.json({ counts, jobs: jobs.map(shape), recent: recent.map(shape), workerSeen: seen ? Number(seen.value) : null });
}

export async function POST(req: NextRequest) {
    if (!(await isAdmin())) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    const body = await req.json().catch(() => null);
    const ids: string[] | undefined = Array.isArray(body?.ids) ? body.ids.filter((i: unknown) => typeof i === 'string') : undefined;
    if (body?.action === 'retry') {
        await prisma.batcaveJob.updateMany({ where: ids ? { id: { in: ids } } : { status: { in: ['NOT_FOUND', 'ERROR'] } }, data: { status: 'QUEUED', message: null } });
    } else if (body?.action === 'clearDone') {
        await prisma.batcaveJob.deleteMany({ where: { status: 'DONE' } });
    } else if (body?.action === 'remove' && ids) {
        await prisma.batcaveJob.deleteMany({ where: { id: { in: ids } } });
    } else {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
