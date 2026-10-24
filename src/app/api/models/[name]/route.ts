// src/app/api/models/[name]/route.ts
//
// Fork only: machine-learning models the browser runs (the guided view's speech-bubble detector, see
// src/workers/bubble-worker.ts), read from <config>/models. Versioned file names, so they cache forever.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { CONFIG_DIR } from '@/lib/utils/paths';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    const { name } = await params;
    if (!/^[\w.-]+\.onnx$/.test(name)) return new NextResponse('Not found', { status: 404 });
    const file = path.join(CONFIG_DIR, 'models', name);
    if (!fs.existsSync(file)) return new NextResponse('Model not installed', { status: 404 });
    return new NextResponse(fs.readFileSync(file), {
        headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
}
