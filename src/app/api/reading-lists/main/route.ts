// Fork only: the user's main reading list, opened by default on the Reading Lists page.
// Stored as a SystemSetting per user so it follows the user across devices without a schema change.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { getErrorMessage } from '@/lib/utils/error';

export const dynamic = 'force-dynamic';

const keyFor = (userId: string) => `reading_list_main:${userId}`;

async function currentUserId() {
    const session = await getServerSession(await getAuthOptions());
    return (session?.user as any)?.id as string | undefined;
}

export async function GET() {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const setting = await prisma.systemSetting.findUnique({ where: { key: keyFor(userId) } });
    return NextResponse.json({ listId: setting?.value || null });
}

export async function PUT(request: Request) {
    try {
        const userId = await currentUserId();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const { listId } = await request.json();
        if (!listId) {
            await prisma.systemSetting.deleteMany({ where: { key: keyFor(userId) } });
            return NextResponse.json({ listId: null });
        }
        const visible = await prisma.readingList.findFirst({
            where: { id: String(listId), OR: [{ userId }, { isGlobal: true }, { userId: null }] }, select: { id: true }
        });
        if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });
        await prisma.systemSetting.upsert({
            where: { key: keyFor(userId) }, update: { value: visible.id }, create: { key: keyFor(userId), value: visible.id }
        });
        return NextResponse.json({ listId: visible.id });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
