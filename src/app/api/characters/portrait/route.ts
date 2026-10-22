// Fork only: portrait for the Characters page. One ComicVine character search per (publisher, name),
// remembered for good as a SystemSetting ('' = nothing found, so a miss is not searched again).
// ?candidates=1 lists ComicVine's matches to choose from; POST (admin) sets a portrait by hand or resets it.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { cachedCvGet } from '@/lib/metadata/metadata-cache';
import { pickPortrait } from '@/lib/reading-list-groups';

export const dynamic = 'force-dynamic';

const CV = 'https://comicvine.gamespot.com/api';
const keyOf = (publisher: string, name: string) => `character_portrait:${publisher}:${name}`.slice(0, 190);
const isPlaceholder = (url?: string | null) => !url || /\/6373148-blank\.png$|blank\.png$/i.test(url);

// ComicVine's /search/ may answer with placeholder images (as it does for volumes since 22.10.): fill them from
// /characters/ in one call. Results keep the search order.
async function searchCharacters(cvKey: string, name: string, limit: number) {
    const res = await cachedCvGet(`${CV}/search/`, {
        params: { api_key: cvKey, format: 'json', query: name, resources: 'character', limit, field_list: 'id,name,image,publisher,deck,count_of_issue_appearances' },
        headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 8000,
    });
    let results: any[] = res.data?.results || [];
    const ids = results.filter(r => r?.id && (isPlaceholder(r.image?.medium_url) || !r.publisher || r.count_of_issue_appearances == null)).map(r => r.id);
    if (ids.length > 0) {
        try {
            const full = await cachedCvGet(`${CV}/characters/`, {
                params: { api_key: cvKey, format: 'json', filter: `id:${ids.join('|')}`, limit: 100, field_list: 'id,image,publisher,deck,count_of_issue_appearances' },
                headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 8000,
            });
            const byId = new Map((full.data?.results || []).map((c: any) => [c.id, c]));
            results = results.map(r => ({ ...r, ...((byId.get(r.id) as object) || {}) }));
        } catch { /* keep what the search gave */ }
    }
    return results.map(r => isPlaceholder(r.image?.medium_url) ? { ...r, image: null } : r);
}

export async function GET(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const name = (params.get('name') || '').trim();
    const publisher = (params.get('publisher') || '').trim();
    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

    const cvKey = (await prisma.systemSetting.findUnique({ where: { key: 'cv_api_key' } }))?.value;
    if (params.get('candidates')) {
        if (!cvKey) return NextResponse.json({ candidates: [] });
        try {
            const found = await searchCharacters(cvKey, name, 20);
            return NextResponse.json({ candidates: found.filter(r => r.image).map(r => ({
                name: r.name, publisher: r.publisher?.name || null, deck: r.deck || null, url: r.image.medium_url || r.image.original_url,
            })) });
        } catch {
            return NextResponse.json({ error: 'ComicVine is not answering right now.' }, { status: 503 });
        }
    }

    const key = keyOf(publisher, name);
    const known = await prisma.systemSetting.findUnique({ where: { key } });
    if (known && !isPlaceholder(known.value)) return NextResponse.json({ url: known.value || null });
    if (known && known.value === '') return NextResponse.json({ url: null });

    if (!cvKey) return NextResponse.json({ url: null });
    let url: string | null = null;
    try {
        url = pickPortrait(await searchCharacters(cvKey, name, 10), name, publisher);
    } catch {
        return NextResponse.json({ url: null }); // not remembered: ComicVine may just be rate limiting
    }
    await prisma.systemSetting.upsert({ where: { key }, update: { value: url || '' }, create: { key, value: url || '' } });
    return NextResponse.json({ url });
}

// Admin: { name, publisher, url } sets the portrait; url null/empty resets it to the automatic pick.
export async function POST(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    if ((session?.user as any)?.role !== 'ADMIN') return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').trim(), publisher = String(body?.publisher || '').trim();
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'The portrait must be an http(s) image URL.' }, { status: 400 });
    const key = keyOf(publisher, name);
    if (url) await prisma.systemSetting.upsert({ where: { key }, update: { value: url }, create: { key, value: url } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
    return NextResponse.json({ url: url || null });
}
