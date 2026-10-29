// Fork only: up to three covers for list cards whose first issues are not in the library yet.
// One ComicVine /issues call covers up to 30 lists (90 issue ids); results are remembered per list.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { cachedCvGet } from '@/lib/metadata/metadata-cache';

export const dynamic = 'force-dynamic';
const PER_LIST = 3;
const MAX_LISTS = 30;

export async function POST(request: Request) {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const ids: string[] = ((await request.json().catch(() => ({})))?.ids || []).slice(0, MAX_LISTS).map(String);
    if (ids.length === 0) return NextResponse.json({});

    const result: Record<string, string[]> = {};
    const known = await prisma.systemSetting.findMany({ where: { key: { in: ids.map(id => `list_covers:${id}`) } } });
    for (const k of known) result[k.key.slice('list_covers:'.length)] = JSON.parse(k.value || '[]');
    const todo = ids.filter(id => !(id in result));
    if (todo.length === 0) return NextResponse.json(result);

    // First items of each list: library cover when there is one, otherwise the ComicVine issue id
    const items = await prisma.readingListItem.findMany({
        where: { listId: { in: todo } }, orderBy: { order: 'asc' },
        select: { listId: true, cvIssueId: true, issue: { select: { coverUrl: true } } },
    });
    const firsts = new Map<string, typeof items>();
    for (const it of items) {
        const l = firsts.get(it.listId) || [];
        if (l.length < PER_LIST && (it.issue?.coverUrl || it.cvIssueId)) firsts.set(it.listId, [...l, it]);
    }
    const cvIds = [...new Set([...firsts.values()].flat().filter(it => !it.issue?.coverUrl && it.cvIssueId).map(it => it.cvIssueId!))];

    const images = new Map<number, string>();
    const cvKey = (await prisma.systemSetting.findUnique({ where: { key: 'cv_api_key' } }))?.value;
    if (cvIds.length && cvKey) {
        try {
            const res = await cachedCvGet('https://comicvine.gamespot.com/api/issues/', {
                params: { api_key: cvKey, format: 'json', filter: `id:${cvIds.join('|')}`, field_list: 'id,image', limit: 100 },
                headers: { 'User-Agent': 'Omnibus/1.0' }, timeout: 10000,
            });
            for (const r of res.data?.results || []) {
                const url = r?.image?.medium_url || r?.image?.small_url;
                if (r?.id && url) images.set(Number(r.id), url);
            }
        } catch {
            return NextResponse.json(result); // rate limited or offline: try again next time, nothing remembered
        }
    }

    for (const id of todo) {
        const covers = (firsts.get(id) || []).flatMap(it => {
            const url = it.issue?.coverUrl || (it.cvIssueId ? images.get(it.cvIssueId) : undefined);
            return url ? [url] : [];
        });
        result[id] = covers;
        // Nothing found (list still empty, no such list): not remembered, so covers show once issues are added
        if (covers.length === 0) continue;
        await prisma.systemSetting.upsert({
            where: { key: `list_covers:${id}` }, update: { value: JSON.stringify(covers) }, create: { key: `list_covers:${id}`, value: JSON.stringify(covers) },
        });
    }
    return NextResponse.json(result);
}
