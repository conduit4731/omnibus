// Fork only: after a redeploy, a page the browser kept in memory (Safari/Brave on iPad, home-screen
// PWA) asks for JS chunks of the old build that no longer exist, and Next.js shows
// "Application error: a client-side exception". Reload once instead; the fresh HTML names the new chunks.

const KEY = 'omnibus-stale-build-reload';

/** True for errors that mean "this page belongs to an older build". */
export function isStaleBuildError(error: unknown): boolean {
    const e = error as { name?: string, message?: string } | null;
    return e?.name === 'ChunkLoadError'
        || /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(e?.message || '');
}

/** Reloads the page unless it already did so in the last 30 s (so a real outage cannot loop). */
export function reloadOnce(): boolean {
    try {
        const last = Number(sessionStorage.getItem(KEY) || 0);
        if (Date.now() - last < 30_000) return false;
        sessionStorage.setItem(KEY, String(Date.now()));
    } catch { /* storage blocked: still reload once */ }
    window.location.reload();
    return true;
}
