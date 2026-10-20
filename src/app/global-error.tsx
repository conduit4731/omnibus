"use client";
// Fork only: root error boundary. Stale-build chunk errors reload the page once; anything else shows a
// minimal message with a reload button instead of Next's bare "Application error".
import { useEffect } from "react";
import { isStaleBuildError, reloadOnce } from "@/lib/stale-build-reload";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
    useEffect(() => {
        if (isStaleBuildError(error)) reloadOnce();
        else console.error(error);
    }, [error]);

    return (
        <html lang="en">
            <body style={{ background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', margin: 0, gap: 12, textAlign: 'center', padding: 16 }}>
                <h2 style={{ margin: 0 }}>Something went wrong</h2>
                <p style={{ margin: 0, color: '#94a3b8', maxWidth: 420 }}>{error?.message || 'Unknown error'}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => reset()} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: 'inherit' }}>Try again</button>
                    <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#3b82f6', color: 'white' }}>Reload</button>
                </div>
            </body>
        </html>
    );
}
