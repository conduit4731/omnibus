// src/app/api/batcave/match/route.ts
//
// Fork-only (see src/lib/batcave.ts). POST { titles: ["The Flash (2010)", …] } with an admin API key →
// per title the Omnibus series it maps to and the issue numbers already on disk.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateApiKey } from '@/lib/api-auth';
import { normIssueNumber, pickSeries } from '@/lib/batcave';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await validateApiKey(req);
    if (!auth.valid || (auth.keyType !== 'ADMIN_KEY' && auth.keyType !== 'LEGACY_ADMIN')) {
        return NextResponse.json({ error: 'Admin API key required' }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    const titles: string[] = Array.isArray(body?.titles) ? body.titles.filter((t: unknown) => typeof t === 'string').slice(0, 500) : [];

    const rows = await prisma.series.findMany({ select: { id: true, name: true, year: true, folderPath: true } });
    const result: Record<string, { id: string; name: string; year: number; have: string[]; haveAnnual: string[] } | null> = {};
    for (const title of titles) {
        const s = pickSeries(rows, title);
        if (!s) { result[title] = null; continue; }
        const issues = await prisma.issue.findMany({ where: { seriesId: s.id, status: 'DOWNLOADED' }, select: { number: true, isAnnual: true } });
        result[title] = {
            id: s.id, name: s.name, year: s.year,
            have: issues.filter(i => !i.isAnnual).map(i => normIssueNumber(i.number)),
            haveAnnual: issues.filter(i => i.isAnnual).map(i => normIssueNumber(i.number)),
        };
    }
    return NextResponse.json({ series: result });
}
