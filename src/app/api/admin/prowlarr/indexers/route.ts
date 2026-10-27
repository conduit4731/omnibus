// src/app/api/admin/prowlarr/indexers/route.ts
import { NextResponse } from 'next/server';
import axios from 'axios';
import { prisma } from '@/lib/db';
import { setupGate } from '@/lib/api-auth';
import { Logger } from '@/lib/logger'; 
import { getErrorMessage } from '@/lib/utils/error';

export async function POST(request: Request) {
  try {
    // --- SECURITY ENFORCEMENT ---
    if (!(await setupGate()).allowed) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { url, apiKey, headers } = await request.json();
    const cleanUrl = url.replace(/\/$/, '');

    // --- THE FIX: Unmask the API key if it's currently hidden by the frontend UI ---
    let realApiKey = apiKey;
    if (realApiKey === '********') {
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'prowlarr_key' } });
        realApiKey = setting?.value || "";
    }

    const extraHeaders: Record<string, string> = {};
    if (headers && Array.isArray(headers)) {
        // Settings shows saved header values masked; '********' means "the saved value" (as in admin/test)
        const saved = headers.some((h: any) => h.value === '********') ? await prisma.customHeader.findMany() : [];
        headers.forEach((h: any) => {
            const value = h.value === '********' ? saved.find(s => s.id === h.id)?.value : h.value;
            if (h.key && value) extraHeaders[h.key] = value;
        });
    }

    Logger.log(`[Prowlarr] Fetching indexers from: ${cleanUrl}`, 'info'); 

    const res = await axios.get(`${cleanUrl}/api/v1/indexer`, {
      headers: { 'X-Api-Key': realApiKey, ...extraHeaders },
      timeout: 10000
    });

    if (!Array.isArray(res.data)) {
        Logger.log(`[Prowlarr] Response was not an array: ${JSON.stringify(res.data).substring(0, 100)}`, 'error'); 
        throw new Error("Prowlarr returned invalid data format.");
    }

    Logger.log(`[Prowlarr] Raw count: ${res.data.length}`, 'info'); 

    const mapped = res.data
        .filter((idx: any) => idx.id && idx.name) 
        .map((idx: any) => ({
            id: idx.id,
            name: idx.name,
            protocol: idx.protocol, 
            priority: idx.priority || 25,
            rss: idx.enableRss || false,
            seedTime: 0 
        }));

    Logger.log(`[Prowlarr] Mapped count: ${mapped.length}`, 'success'); 

    return NextResponse.json(mapped);
  } catch (error: unknown) {
    Logger.log(`[Prowlarr] Refresh Error: ${getErrorMessage(error)}`, 'error'); 
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}