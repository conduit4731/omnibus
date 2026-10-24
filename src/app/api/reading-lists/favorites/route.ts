// Fork only: the user's favorite reading lists (starred; the first opens by default, all show on the home screen).
// Stored as a SystemSetting per user (JSON array of list ids) so it follows the user across devices without a schema
// change. Replaces the single "main list" (reading_list_main:<user>), which becomes the first favorite.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { getErrorMessage } from '@/lib/utils/error';
import { listMeta } from '@/lib/reading-list-meta';

export const dynamic = 'force-dynamic';

const keyFor = (userId: string) => `reading_list_favorites:${userId}`;

async function currentUserId() {
    const session = await getServerSession(await getAuthOptions());
    return (session?.user as any)?.id as string | undefined;
}

async function load(userId: string): Promise<string[]> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: keyFor(userId) } });
    if (setting) { try { const ids = JSON.parse(setting.value); if (Array.isArray(ids)) return ids.map(String); } catch { /* rewrite below */ } }
    const main = await prisma.systemSetting.findUnique({ where: { key: `reading_list_main:${userId}` } });
    return main?.value ? [main.value] : [];
}

// categories: list id → category ("Characters", "Events", …), so the home screen can give character lists their own shelf
export async function GET() {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const listIds = await load(userId);
    const rows = await prisma.readingList.findMany({ where: { id: { in: listIds } }, select: { id: true, name: true, description: true, updatedAt: true } });
    const meta = await listMeta(rows);
    return NextResponse.json({ listIds, categories: Object.fromEntries(rows.map(r => [r.id, meta.get(r.id)?.category || 'Lists'])) });
}

// { listId, favorite: true | false }
export async function PUT(request: Request) {
    try {
        const userId = await currentUserId();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const { listId, favorite } = await request.json();
        if (!listId) return NextResponse.json({ error: "Missing listId" }, { status: 400 });
        let ids = (await load(userId)).filter(id => id !== String(listId));
        if (favorite) {
            const visible = await prisma.readingList.findFirst({
                where: { id: String(listId), OR: [{ userId }, { isGlobal: true }, { userId: null }] }, select: { id: true }
            });
            if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });
            ids = [...ids, visible.id];
        }
        const value = JSON.stringify(ids);
        await prisma.systemSetting.upsert({ where: { key: keyFor(userId) }, update: { value }, create: { key: keyFor(userId), value } });
        await prisma.systemSetting.deleteMany({ where: { key: `reading_list_main:${userId}` } });
        return NextResponse.json({ listIds: ids });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
