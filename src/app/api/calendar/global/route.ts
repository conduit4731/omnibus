// src/app/api/calendar/global/route.ts
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth/next';
import { getAuthOptions } from '@/app/api/auth/[...nextauth]/options';
import { Logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/utils/error';
import { findLocalSeriesMatch } from '@/lib/utils/series-match';
import { getMetronAuth, metronGet, MetronHttpError, MetronRateLimitError } from '@/lib/metron/client';

const MAX_RANGE_DAYS = 45;
const TAGGED_PUBLISHERS = ['DC Comics', 'Marvel', 'Image', 'Dark Horse Comics', 'IDW Publishing', 'BOOM! Studios', 'Dynamite Entertainment', 'Titan Comics', 'Rebellion'];

export async function GET(request: Request) {
    try {
        const authOptions = await getAuthOptions();
        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const weekOffset = parseInt(searchParams.get('weekOffset') || '0', 10);

        // --- STRICT SUNDAY TO SATURDAY WEEK ALIGNMENT ---
        const today = new Date();
        const currentDayOfWeek = today.getUTCDay(); 
        
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        start.setUTCDate(start.getUTCDate() - currentDayOfWeek + (weekOffset * 7));

        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6); // 7 day window inclusive

        let startDateStr = start.toISOString().split('T')[0];
        let endDateStr = end.toISOString().split('T')[0];
        const todayStr = today.toISOString().split('T')[0];

        // Fork: ?from=&to= (up to 45 days) — the calendar's week / month views fetch their whole range in one
        // pass (one issue list + one query per tagged publisher) instead of 15-20 Metron calls per week.
        const from = searchParams.get('from'), to = searchParams.get('to');
        if (from && to) {
            const day = /^\d{4}-\d{2}-\d{2}$/;
            const span = (Date.parse(to) - Date.parse(from)) / 86400000;
            if (!day.test(from) || !day.test(to) || !(span >= 0 && span <= MAX_RANGE_DAYS)) {
                return NextResponse.json({ error: `from/to must be YYYY-MM-DD, at most ${MAX_RANGE_DAYS} days apart.` }, { status: 400 });
            }
            startDateStr = from; endDateStr = to;
        }
        
        // Fork: cached per date range. A range that ended before today no longer changes and is kept; a
        // current or future one is refetched once a day. (Was: one key per day and week offset, so every
        // week was fetched again each day and the old keys piled up.)
        const cacheKey = `calendar_global_v19_${startDateStr}_${endDateStr}`;
        const cache = await prisma.systemSetting.findUnique({ where: { key: cacheKey } });
        if (cache?.value) {
            const cached = JSON.parse(cache.value);
            if (endDateStr < todayStr || cached.fetchedAt === todayStr) {
                return NextResponse.json({ startDate: startDateStr, endDate: endDateStr, releases: cached.releases });
            }
        }

        const metronAuth = await getMetronAuth();
        if (!metronAuth) {
            return NextResponse.json({ error: "Metron credentials missing in Settings. Cannot fetch global pull list." }, { status: 400 });
        }

        let nextUrl: string | null = `https://metron.cloud/api/issue/?store_date_range_after=${startDateStr}&store_date_range_before=${endDateStr}`;
        const allIssues: any[] = [];

        Logger.log(`[Global Calendar] Fetching Metron releases for ${startDateStr} to ${endDateStr}`, 'info');

        // Through the shared Metron client (pacing from Metron's rate-limit headers, 429s honoured - a
        // long one ends the fetch). A failure is NOT cached: the next view tries again, instead of the
        // empty week the old loop cached for the rest of the day.
        try {
            while (nextUrl && allIssues.length < 5000) { // fork: up to 45 days per call
                const res = await metronGet(nextUrl, { auth: metronAuth, pace: 'interactive', cache: false });
                if (res.status !== 200) throw new MetronHttpError(res.status);
                const data: any = res.data || {};
                if (Array.isArray(data.results)) allIssues.push(...data.results);
                nextUrl = data.next || null;
            }
        } catch (fetchError) {
            Logger.log(`[Global Calendar] Metron fetch failed: ${getErrorMessage(fetchError)}`, 'warn');
            const message = fetchError instanceof MetronRateLimitError
                ? 'Metron is rate-limiting requests right now. Try again in a little while.'
                : 'Could not load the global pull list from Metron.';
            return NextResponse.json({ error: message }, { status: 503 });
        }

        // Fork: Metron's issue list carries no publisher (the calendar's publisher filter showed almost
        // everything as Unknown). One filtered query per big publisher tags its issues; failures only
        // leave issues untagged. A filter Metron ignored would return every issue, so that is discarded.
        const publisherOf = new Map<number, string>();
        for (const name of TAGGED_PUBLISHERS) {
            try {
                let url: string | null = `https://metron.cloud/api/issue/?store_date_range_after=${startDateStr}&store_date_range_before=${endDateStr}&publisher_name=${encodeURIComponent(name)}`;
                const ids: number[] = [];
                while (url && ids.length < 5000) {
                    const res = await metronGet(url, { auth: metronAuth, pace: 'interactive', cache: false });
                    if (res.status !== 200) break;
                    const data: any = res.data || {};
                    if (Array.isArray(data.results)) ids.push(...data.results.map((i: any) => i.id));
                    url = data.next || null;
                }
                if (ids.length < allIssues.length) for (const id of ids) if (!publisherOf.has(id)) publisherOf.set(id, name);
            } catch {
                break; // rate limited: keep what we have
            }
        }

        const localSeries = await prisma.series.findMany({
            select: { id: true, name: true, year: true, publisher: true, metadataId: true, metadataSource: true, monitored: true, folderPath: true }
        });
        
        const nameToPubMap = new Map<string, string>();
        localSeries.forEach(s => {
            if (s.name && s.publisher && s.publisher !== "Unknown") {
                nameToPubMap.set(s.name.toLowerCase().trim(), s.publisher);
            }
        });

        // Each release → the local series it resolved to, recorded so the monitored block below reuses the
        // SAME year-aware match (the badge and the auto-created WANTED rows can never land on different volumes).
        const releaseMatches = new Map<object, (typeof localSeries)[number] | null>();

        const formattedReleases = allIssues.map(issue => {
            const rawSeriesName = typeof issue.series === 'object' ? issue.series?.name : issue.series;
            const seriesName = rawSeriesName ? rawSeriesName.trim() : "Unknown";
            const normalizedName = seriesName.toLowerCase();
            const releaseYear = issue.series?.year_began ? parseInt(issue.series.year_began, 10) : null;

            // Name is the only cross-provider key (Metron pull list vs ComicVine library), but resolve it
            // year-aware so an owned "X-Men (2019)" doesn't flag a new "X-Men (2024)" release as in-library.
            const localMatch = findLocalSeriesMatch(localSeries, seriesName, releaseYear);
            const volumeId = localMatch ? localMatch.metadataId : (typeof issue.series === 'object' ? issue.series?.id : null);
            const metadataSource = localMatch ? localMatch.metadataSource : 'METRON';
            const publisher = nameToPubMap.get(normalizedName) || localMatch?.publisher || publisherOf.get(issue.id) || "Unknown";

            const release = {
                id: issue.id,
                volumeId: volumeId,
                metadataSource: metadataSource,
                seriesName: seriesName,
                issueNumber: issue.number || issue.issue || "1",
                publisher: publisher,
                releaseDate: issue.store_date || issue.cover_date,
                coverUrl: issue.image || null,
                description: issue.desc || issue.description || null,
                year: issue.series?.year_began?.toString() || startDateStr.split('-')[0],
                monitored: localMatch?.monitored || false,
                inLibrary: !!localMatch,
                seriesPath: localMatch?.folderPath || undefined // fork: the calendar opens owned series
            };
            releaseMatches.set(release, localMatch);
            return release;
        });

        const monitoredSeries = localSeries.filter(s => s.monitored);
        if (monitoredSeries.length > 0) {
            const existingIssues = await prisma.issue.findMany({
                where: { seriesId: { in: monitoredSeries.map(s => s.id) } },
                select: { seriesId: true, number: true }
            });

            const issuesToCreate: any[] = [];
            for (const release of formattedReleases) {
                // Reuse the badge's year-aware resolution — never auto-create a WANTED row on a same-named
                // wrong volume (e.g. a new "X-Men (2024)" landing under a monitored "X-Men (2019)").
                const matchedSeries = releaseMatches.get(release);
                if (matchedSeries && matchedSeries.monitored) {
                    const alreadyExists = existingIssues.some(i => i.seriesId === matchedSeries.id && parseFloat(i.number) === parseFloat(release.issueNumber));
                    if (!alreadyExists) {
                        issuesToCreate.push({
                            seriesId: matchedSeries.id,
                            metadataId: release.id.toString(),
                            metadataSource: 'METRON',
                            matchState: 'MATCHED',
                            number: release.issueNumber?.toString() || '0',
                            name: release.seriesName,
                            releaseDate: release.releaseDate,
                            coverUrl: release.coverUrl,
                            status: 'WANTED'
                        });
                    }
                }
            }
            
            if (issuesToCreate.length > 0) {
                await prisma.issue.createMany({ data: issuesToCreate }).catch(()=> {});
            }
        }

        const value = JSON.stringify({ fetchedAt: todayStr, releases: formattedReleases });
        await prisma.systemSetting.upsert({ where: { key: cacheKey }, update: { value }, create: { key: cacheKey, value } });

        // Older cache generations (v15, v16 and the fork's v16p day keys)
        await prisma.systemSetting.deleteMany({
            where: { OR: ['calendar_global_v15_', 'calendar_global_v16_', 'calendar_global_v16p_', 'calendar_global_v17_', 'calendar_global_v18_'].map(p => ({ key: { startsWith: p } })) }
        }).catch(()=>{});

        return NextResponse.json({ startDate: startDateStr, endDate: endDateStr, releases: formattedReleases });

    } catch (error: any) {
        Logger.log(`Global Calendar API Error: ${getErrorMessage(error)}`, 'error');
        return NextResponse.json({ error: "Failed to fetch global releases from Metron." }, { status: 500 });
    }
}