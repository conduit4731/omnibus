// src/app/api/batcave/worker/route.ts
//
// Fork-only: the userscript worker in an open Batcave tab (admin API key).
//   GET  ?limit=40 → queued jobs, oldest first, with series name/year and the remembered Batcave news id.
//        Jobs whose issue is on disk by now, or whose series is gone, are closed on the way.
//   POST { results: [{ id, status: DONE|NOT_FOUND|ERROR|QUEUED, message? }], news?: { seriesId: newsId } }
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateApiKey } from '@/lib/api-auth';
import { normIssueNumber } from '@/lib/batcave';
import { closeDeliveredRequests } from '@/lib/batcave-queue';
import { Logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const NEWS_MAP_KEY = 'batcave_news_map';
const WORKER_SEEN_KEY = 'batcave_worker_seen';  // epoch ms of the last poll, shown on /batcave
const STATUSES = new Set(['DONE', 'NOT_FOUND', 'ERROR', 'QUEUED']);

async function authorized(req: NextRequest) {
    const auth = await validateApiKey(req);
    return auth.valid && (auth.keyType === 'ADMIN_KEY' || auth.keyType === 'LEGACY_ADMIN');
}

async function newsMap(): Promise<Record<string, number>> {
    const row = await prisma.systemSetting.findUnique({ where: { key: NEWS_MAP_KEY } });
    return row ? JSON.parse(row.value) : {};
}

export async function GET(req: NextRequest) {
    if (!(await authorized(req))) return NextResponse.json({ error: 'Admin API key required' }, { status: 401 });
    const now = String(Date.now());
    await prisma.systemSetting.upsert({ where: { key: WORKER_SEEN_KEY }, update: { value: now }, create: { key: WORKER_SEEN_KEY, value: now } });
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 40));
    const jobs = await prisma.batcaveJob.findMany({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take: limit * 2 });
    const seriesIds = [...new Set(jobs.map(j => j.seriesId))];
    const series = new Map((await prisma.series.findMany({ where: { id: { in: seriesIds } }, select: { id: true, name: true, year: true } })).map(s => [s.id, s]));
    const have = new Set((await prisma.issue.findMany({ where: { seriesId: { in: seriesIds }, status: 'DOWNLOADED' }, select: { seriesId: true, number: true, isAnnual: true } }))
        .map(i => `${i.seriesId}|${normIssueNumber(i.number)}|${i.isAnnual}`));
    const map = await newsMap();
    const out = [];
    for (const j of jobs) {
        const s = series.get(j.seriesId);
        if (!s) { await prisma.batcaveJob.update({ where: { id: j.id }, data: { status: 'ERROR', message: 'Serie in Omnibus gelöscht' } }); continue; }
        if (have.has(`${j.seriesId}|${j.number}|${j.isAnnual}`)) { await prisma.batcaveJob.update({ where: { id: j.id }, data: { status: 'DONE', message: 'schon vorhanden' } }); continue; }
        if (out.length < limit) out.push({ id: j.id, seriesId: j.seriesId, seriesName: s.name, year: s.year, number: j.number, isAnnual: j.isAnnual, newsId: map[j.seriesId] || null });
    }
    const queued = await prisma.batcaveJob.count({ where: { status: 'QUEUED' } });
    // Requests whose issue Batcave delivered leave "Needs action" / Awaiting (the tab polls every few minutes)
    await closeDeliveredRequests().catch(e => Logger.log(`[Batcave] closing delivered requests: ${e}`, 'warn'));
    return NextResponse.json({ jobs: out, queued });
}

export async function POST(req: NextRequest) {
    if (!(await authorized(req))) return NextResponse.json({ error: 'Admin API key required' }, { status: 401 });
    const body = await req.json().catch(() => null);
    for (const r of Array.isArray(body?.results) ? body.results : []) {
        if (typeof r?.id !== 'string' || !STATUSES.has(r.status)) continue;
        await prisma.batcaveJob.update({ where: { id: r.id }, data: { status: r.status, message: typeof r.message === 'string' ? r.message.slice(0, 300) : null } }).catch(() => {});
    }
    if (body?.news && typeof body.news === 'object') {
        const map = await newsMap();
        for (const [seriesId, newsId] of Object.entries(body.news)) if (Number(newsId) > 0) map[seriesId] = Number(newsId);
        await prisma.systemSetting.upsert({ where: { key: NEWS_MAP_KEY }, update: { value: JSON.stringify(map) }, create: { key: NEWS_MAP_KEY, value: JSON.stringify(map) } });
    }
    return NextResponse.json({ ok: true });
}
