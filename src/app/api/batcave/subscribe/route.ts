// src/app/api/batcave/subscribe/route.ts
//
// Fork-only (see src/lib/batcave.ts). POST { titles: ["Flashpoint: Reverse-Flash", "The Flash (2010)", …] } with an
// admin API key → finds each title's ComicVine volume and adds it to Omnibus like "Subscribe" does (folder from the
// naming pattern, metadata sync, followed by the key's user), but NOT monitored: the Batcave userscript fetches the
// issues, the gap backfill must not search them again on GetComics. An already existing volume (same ComicVine id)
// is reused. Every resolution is remembered in BATCAVE_MAP_KEY so /match finds it next time; a new series also
// triggers batcave-import.sh (.neu) for files already waiting in the inbox.
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import { prisma } from '@/lib/db';
import { validateApiKey } from '@/lib/api-auth';
import { Logger } from '@/lib/logger';
import { cachedCvGet } from '@/lib/metadata/metadata-cache';
import { addSeriesFromCv } from '@/lib/batcave-queue';
import { BATCAVE_MAP_KEY, parseBatcaveTitle, pickCvVolume, titleKey } from '@/lib/batcave';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await validateApiKey(req);
    if (!auth.valid || (auth.keyType !== 'ADMIN_KEY' && auth.keyType !== 'LEGACY_ADMIN')) {
        return NextResponse.json({ error: 'Admin API key required' }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    const titles: string[] = Array.isArray(body?.titles) ? body.titles.filter((t: unknown) => typeof t === 'string').slice(0, 60) : [];
    const cvKey = (await prisma.systemSetting.findUnique({ where: { key: 'cv_api_key' } }))?.value;
    if (!cvKey) return NextResponse.json({ error: 'No ComicVine API key in Omnibus' }, { status: 400 });

    const mapRow = await prisma.systemSetting.findUnique({ where: { key: BATCAVE_MAP_KEY } });
    const map: Record<string, string> = mapRow ? JSON.parse(mapRow.value) : {};

    const result: Record<string, { id: string; name: string; year: number; created: boolean } | { error: string }> = {};
    for (const title of titles) {
        try {
            const query = parseBatcaveTitle(title)?.name || title;
            const res = await cachedCvGet('https://comicvine.gamespot.com/api/search/', {
                params: { api_key: cvKey, format: 'json', query, resources: 'volume', limit: 50, field_list: 'id,name,start_year,publisher,count_of_issues' },
                headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 10000,
            });
            const hits = res.data?.results || [];
            const vol = pickCvVolume(hits, title);
            if (!vol) {
                const near = hits.slice(0, 5).map((h: { name: string; start_year: unknown; count_of_issues?: number }) => `${h.name} (${h.start_year}, ${h.count_of_issues ?? '?'} Hefte)`);
                result[title] = { error: 'Bei ComicVine nicht eindeutig gefunden' + (near.length ? '. Treffer: ' + near.join('; ') : ', keine Treffer') };
                continue;
            }

            const { series, created } = await addSeriesFromCv(vol, auth.user?.id, parseBatcaveTitle(title)?.year);
            map[titleKey(title)] = series.id;
            result[title] = { id: series.id, name: series.name, year: series.year, created };
        } catch (e) {
            result[title] = { error: String(e instanceof Error ? e.message : e) };
        }
    }
    // Hefte, die schon in der Inbox auf ihre Serie warten (manuelle Batcave-Downloads), beim nächsten Cron-Lauf importieren
    if (process.env.OMNIBUS_BATCAVE_INBOX && Object.values(result).some(r => 'created' in r && r.created)) {
        await fs.writeFile(path.join(process.env.OMNIBUS_BATCAVE_INBOX, '.neu'), '').catch(() => {});
    }
    await prisma.systemSetting.upsert({
        where: { key: BATCAVE_MAP_KEY }, update: { value: JSON.stringify(map) }, create: { key: BATCAVE_MAP_KEY, value: JSON.stringify(map) },
    });
    return NextResponse.json({ series: result });
}
