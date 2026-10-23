// src/app/api/batcave/upload/route.ts
//
// Fork-only (see src/lib/batcave.ts). POST raw CBZ body, ?series=<Omnibus series id>&number=7[&annual=1],
// admin API key. Writes <OMNIBUS_BATCAVE_INBOX>/web-<series id>/<name>.cbz plus a .series-id file, so
// batcave-import.sh files it under that series without guessing from the name, and touches .neu,
// which the host cron picks up once uploads have been quiet for a minute.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/db';
import { validateApiKey } from '@/lib/api-auth';
import { Logger } from '@/lib/logger';
import { uploadFileName } from '@/lib/batcave';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1024 * 1024 * 1024;

export async function POST(req: NextRequest) {
    const inbox = process.env.OMNIBUS_BATCAVE_INBOX;
    if (!inbox) return NextResponse.json({ error: 'OMNIBUS_BATCAVE_INBOX not set' }, { status: 404 });
    const auth = await validateApiKey(req);
    if (!auth.valid || (auth.keyType !== 'ADMIN_KEY' && auth.keyType !== 'LEGACY_ADMIN')) {
        return NextResponse.json({ error: 'Admin API key required' }, { status: 401 });
    }
    const q = req.nextUrl.searchParams;
    const number = q.get('number') || '';
    if (!/^[0-9a-z.]{1,10}$/i.test(number) || !req.body) return NextResponse.json({ error: 'number and body required' }, { status: 400 });
    const series = await prisma.series.findUnique({ where: { id: q.get('series') || '' }, select: { id: true, name: true, year: true } });
    if (!series) return NextResponse.json({ error: 'Unknown series' }, { status: 404 });

    const dir = path.join(inbox, 'web-' + series.id.replace(/[^\w-]/g, ''));
    const name = uploadFileName(series.name, series.year, number, q.get('annual') === '1');
    const target = path.join(dir, name);
    const part = target + '.part';  // batcave-import.sh only picks up *.cbz
    await fs.ensureDir(dir);

    let bytes = 0;
    const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            bytes += chunk.length;
            cb(bytes > MAX_BYTES ? new Error('UPLOAD_TOO_LARGE') : null, chunk);
        },
    });
    try {
        await pipeline(Readable.fromWeb(req.body as unknown as NodeWebReadableStream), counter, fs.createWriteStream(part));
    } catch (e) {
        await fs.remove(part).catch(() => {});
        return NextResponse.json({ error: String(e) }, { status: bytes > MAX_BYTES ? 413 : 500 });
    }
    // Declared vs received: a body cut short in transit ends "cleanly" (see admin/upload).
    const declared = Number(req.headers.get('content-length') || 0);
    const head = Buffer.alloc(2);
    const fd = await fs.open(part, 'r');
    await fs.read(fd, head, 0, 2, 0);
    await fs.close(fd);
    if ((declared > 0 && bytes !== declared) || head.toString('latin1') !== 'PK') {
        await fs.remove(part).catch(() => {});
        return NextResponse.json({ error: `Not a complete CBZ (${bytes} of ${declared} bytes)` }, { status: 400 });
    }
    await fs.rename(part, target);
    await fs.writeFile(path.join(dir, '.series-id'), series.id);
    await fs.writeFile(path.join(inbox, '.neu'), '');
    Logger.log(`[Batcave] Upload ${name} (${bytes} bytes) for ${series.name} (${series.year})`, 'info');
    return NextResponse.json({ ok: true, name });
}
