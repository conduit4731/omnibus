// Fork only: home screen shelf of the user's favorite reading lists ("Jump Back In" stays for everything else).
// One compact tile per list, like the Continue shelf: the next issues stacked, what's up next, and Continue.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Check, Info, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nextInList } from "@/lib/reading-list-next";
import { FannedCovers, displayName } from "@/components/list-cards";
import { SeriesLink } from "@/components/series-link";

const label = (item: any) => item.issue?.series ? `${item.issue.series.name} #${item.issue.number}` : item.title;
const cover = (item: any) => item.issue?.coverUrl
    || (item.issue?.series?.folderPath ? `/api/library/cover?path=${encodeURIComponent(item.issue.series.folderPath)}` : '/api/library/cover?path=missing');

function ListTile({ list }: { list: any }) {
    const router = useRouter();
    const { item: next, index, skipped } = nextInList<any>(list.items);
    const read = list.items.filter((i: any) => i.progress?.isCompleted).length;
    const pct = list.items.length ? Math.round(100 * read / list.items.length) : 0;
    const finished = !next && skipped.length === 0;
    // The next issue in front, the ones after it in reading order fanned out behind
    const stack = next ? [next, ...list.items.slice(index + 1, index + 3)] : skipped.length ? skipped.slice(0, 3) : list.items.slice(-3);
    const open = (item: any) => router.push(`/reader?path=${encodeURIComponent(item.issue.filePath)}&series=${encodeURIComponent(item.issue.series.folderPath)}`);
    return (
        <div className="flex-none w-[88%] sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.667rem)] 2xl:w-[calc(25%-0.75rem)] snap-start rounded-xl border border-border bg-card/60 p-3 flex gap-3">
            <button className="w-40 shrink-0 py-1" onClick={() => next && open(next)} title={next ? `Read ${label(next)}` : undefined}>
                <FannedCovers covers={stack.map(cover)} className="h-36" />
            </button>
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                <Link href={`/reading-lists?id=${list.id}`} className="font-black leading-tight line-clamp-2 hover:text-primary">{displayName(list.name)}</Link>
                <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    <span className="text-[11px] font-bold text-muted-foreground shrink-0">{read}/{list.items.length}</span>
                </div>
                {next && (
                    <p className="text-xs text-muted-foreground truncate">Up next: <SeriesLink series={next.issue?.series} className="font-bold text-foreground">{label(next)}</SeriesLink></p>
                )}
                {skipped.length > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1" title={skipped.slice(0, 5).map(label).join(', ')}>
                        <Info className="w-3 h-3 shrink-0" /> {skipped.length} missing before{next ? ' — skipped' : ''}
                    </p>
                )}
                <div className="mt-auto pt-1">
                    {next ? <Button size="sm" className="font-bold" onClick={() => open(next)}><BookOpen className="w-4 h-4 mr-1.5" /> {read > 0 || next.progress ? 'Continue' : 'Start'}</Button>
                        : finished ? <span className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Finished</span>
                        : <Button size="sm" variant="outline" asChild><Link href={`/reading-lists?id=${list.id}`}>Request missing</Link></Button>}
                </div>
            </div>
        </div>
    );
}

/** onLoaded: file paths of the favorites' issues, so "Jump Back In" can leave them to this shelf. */
export function ReadingListUpNext({ onLoaded }: { onLoaded?: (filePaths: Set<string>) => void }) {
    const [lists, setLists] = useState<any[] | null>(null);

    useEffect(() => {
        fetch('/api/reading-lists/favorites')
            .then(res => res.ok ? res.json() : { listIds: [] })
            .then(({ listIds }) => Promise.all((listIds || []).map((id: string) =>
                fetch(`/api/reading-lists?id=${encodeURIComponent(id)}`).then(r => r.ok ? r.json() : null).catch(() => null))))
            .then(found => {
                const ok = found.filter((d: any) => d?.items);
                setLists(ok);
                onLoaded?.(new Set(ok.flatMap((d: any) => d.items.flatMap((i: any) => i.issue?.filePath ? [i.issue.filePath] : []))));
            })
            .catch(() => setLists([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
    }, []);

    if (!lists?.length) return null;
    return (
        <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><ListOrdered className="w-6 h-6 text-primary" /> Reading Lists</h2>
            <div className="flex overflow-x-auto gap-4 pb-4 pt-2 px-2 snap-x no-scrollbar -mx-2">
                {lists.map(l => <ListTile key={l.id} list={l} />)}
            </div>
        </div>
    );
}
