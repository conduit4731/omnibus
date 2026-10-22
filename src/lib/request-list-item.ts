// Request one reading-list entry that isn't in the library: its ComicVine / Metron volume (from the linked
// series, else looked up by the entry's issue id), the issue number from the title, and a manual GetComics
// fallback request when the normal request is refused. Shared by the reading list page and the events timeline (fork).
import { Logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/utils/error';

export async function requestListItem(item: any, coverUrl: string | null = null): Promise<void> {
    let volumeId = 0;
    let year = new Date().getFullYear().toString();
    const provider = item.metadataSource || item.issue?.metadataSource || 'COMICVINE';

    if (item.issue?.series?.metadataId && provider === (item.issue.series.metadataSource || 'COMICVINE')) {
        // series already in Omnibus (issue WANTED) - no ComicVine lookup needed
        volumeId = Number(item.issue.series.metadataId) || 0;
        if (item.issue.series.year) year = String(item.issue.series.year);
    } else if (item.cvIssueId) {
        try {
            const lookupRes = await fetch(`/api/reading-lists/lookup-volume?issueId=${item.cvIssueId}&provider=${provider}`);
            if (lookupRes.ok) {
                const data = await lookupRes.json();
                if (data.volumeId) volumeId = data.volumeId;
                if (data.year) year = data.year;
            }
        } catch (e) { Logger.log(`Lookup failed: ${getErrorMessage(e)}`, 'error'); }
    }

    const match = item.title.match(/(?:#|issue\s*#?|ch(?:apter)?\s*\.?)\s*0*(\d+(?:\.\d+)?)/i);
    const issueNumber = match ? match[1] : "1";

    const standardRes = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'issue', cvId: volumeId, name: item.title, year, publisher: "Unknown", image: coverUrl, issueNumber, metadataSource: provider })
    });

    if (!standardRes.ok) {
        const cleanSearchTerm = item.title.split('#')[0].trim().replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "+");
        const fallbackRes = await fetch('/api/reading-lists/manual-fallback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cvId: volumeId, name: item.title, image: coverUrl, searchLink: `https://getcomics.org/?s=${cleanSearchTerm}`, metadataSource: provider })
        });
        if (!fallbackRes.ok) throw new Error("Fallback failed");
    }
}
