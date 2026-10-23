// src/app/api/batcave/queue/route.ts
//
// Fork-only: the "Batcave" button (src/components/batcave-button.tsx). Admin session. Queues issues for the
// userscript worker, see src/lib/batcave-queue.ts. Adding series through ComicVine (reading lists, unowned volumes)
// can take a while: after 8 s the answer goes out and the rest finishes in the background.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { Logger } from '@/lib/logger';
import { queueRequest, type QueueBody } from '@/lib/batcave-queue';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const session = await getServerSession(await getAuthOptions());
    const user = session?.user as { id?: string; role?: string } | undefined;
    if (user?.role !== 'ADMIN') return NextResponse.json({ error: 'Admins only' }, { status: 403 });
    const body = (await req.json().catch(() => null)) as QueueBody | null;
    if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });

    const work = queueRequest(body, user.id);
    work.catch(e => Logger.log(`[Batcave] queue: ${e instanceof Error ? e.message : e}`, 'warn'));
    const queued = await Promise.race([work, new Promise<null>(r => setTimeout(() => r(null), 8000))]).catch(e => e as Error);
    if (queued instanceof Error) return NextResponse.json({ error: queued.message }, { status: 400 });
    return NextResponse.json(queued === null ? { background: true } : { queued });
}
