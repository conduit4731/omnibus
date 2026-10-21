// Fork only: portrait for the Characters page. One ComicVine character search per (publisher, name),
// remembered for good as a SystemSetting ('' = nothing found, so a miss is not searched again).
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { cachedCvGet } from '@/lib/metadata/metadata-cache';
import { pickPortrait } from '@/lib/reading-list-groups';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const name = (params.get('name') || '').trim();
    const publisher = (params.get('publisher') || '').trim();
    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

    const key = `character_portrait:${publisher}:${name}`.slice(0, 190);
    const known = await prisma.systemSetting.findUnique({ where: { key } });
    if (known) return NextResponse.json({ url: known.value || null });

    const cvKey = (await prisma.systemSetting.findUnique({ where: { key: 'cv_api_key' } }))?.value;
    if (!cvKey) return NextResponse.json({ url: null });
    let url: string | null = null;
    try {
        const res = await cachedCvGet('https://comicvine.gamespot.com/api/search/', {
            params: { api_key: cvKey, format: 'json', query: name, resources: 'character', limit: 10, field_list: 'name,image,publisher' },
            headers: { 'User-Agent': 'Omnibus/1.0' },
            timeout: 8000,
        });
        url = pickPortrait(res.data?.results || [], name, publisher);
    } catch {
        return NextResponse.json({ url: null }); // not remembered: ComicVine may just be rate limiting
    }
    await prisma.systemSetting.upsert({ where: { key }, update: { value: url || '' }, create: { key, value: url || '' } });
    return NextResponse.json({ url });
}
