// src/app/api/batcave/guide/route.ts
//
// Fork-only (see src/lib/batcave.ts). POST { event: "Knight Terrors", html: "<p>…</p><h2>Start here…" } with an admin
// API key → the event page's guide (intro, "Start here: the short path" … "Frequently asked questions") is stored,
// sanitized, on every reading list of that name, for the Description tab of the event page. Sent by the userscript
// from its daily catalog sync (Batcave blocks non-browser requests, so the server can't fetch it itself).
// POST { events: ["Dark Reign", …] } (the names on Batcave's event catalog) → { wanted: [...] }, the ones a reading
// list here still lacks a guide for, so the userscript's daily sync only opens those event pages.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateApiKey } from '@/lib/api-auth';
import { sameEvent, wantedGuides } from '@/lib/batcave';
import { sanitizeDescription } from '@/lib/utils/sanitize';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await validateApiKey(req);
    if (!auth.valid || (auth.keyType !== 'ADMIN_KEY' && auth.keyType !== 'LEGACY_ADMIN')) {
        return NextResponse.json({ error: 'Admin API key required' }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    if (Array.isArray(body?.events)) {
        const missing = (await prisma.readingList.findMany({ where: { guide: null }, select: { name: true } })).map(l => l.name);
        const events: string[] = body.events.filter((e: unknown) => typeof e === 'string');
        const wanted = wantedGuides(missing, events);
        return NextResponse.json({ wanted });
    }
    const event = typeof body?.event === 'string' ? body.event : '';
    const guide = sanitizeDescription(typeof body?.html === 'string' ? body.html.slice(0, 200_000) : '', 'https://batcave.biz').trim();
    if (!event || !guide) return NextResponse.json({ error: 'event and html required' }, { status: 400 });

    const lists = (await prisma.readingList.findMany({ select: { id: true, name: true } })).filter(l => sameEvent(l.name, event));
    if (lists.length) await prisma.readingList.updateMany({ where: { id: { in: lists.map(l => l.id) } }, data: { guide } });
    return NextResponse.json({ updated: lists.length });
}
