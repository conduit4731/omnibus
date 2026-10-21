// Fork only: home screen shelf for the user's main reading list ("Jump Back In" stays for everything else).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BookOpen, Info, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { nextInList } from "@/lib/reading-list-next";
import { FannedCovers, displayName } from "@/components/list-cards";

const label = (item: any) => item.issue?.series ? `${item.issue.series.name} #${item.issue.number}` : item.title;
const cover = (item: any) => item.issue?.coverUrl
    || (item.issue?.series?.folderPath ? `/api/library/cover?path=${encodeURIComponent(item.issue.series.folderPath)}` : '/api/library/cover?path=missing');

/** onLoaded: file paths of the list's issues, so "Jump Back In" can leave them to this shelf. */
export function ReadingListUpNext({ onLoaded }: { onLoaded?: (filePaths: Set<string>) => void }) {
    const [list, setList] = useState<any | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetch('/api/reading-lists/main')
            .then(res => res.ok ? res.json() : null)
            .then(main => main?.listId ? fetch(`/api/reading-lists?id=${encodeURIComponent(main.listId)}`) : null)
            .then(res => res?.ok ? res.json() : null)
            .then(data => {
                if (!data?.items) return;
                setList(data);
                onLoaded?.(new Set(data.items.flatMap((i: any) => i.issue?.filePath ? [i.issue.filePath] : [])));
            })
            .catch(() => {});
    }, []);

    if (!list) return null;
    const { item: next, index, skipped } = nextInList<any>(list.items);
    if (!next && skipped.length === 0) return null; // finished
    const read = list.items.filter((i: any) => i.progress?.isCompleted).length;
    const pct = list.items.length ? Math.round(100 * read / list.items.length) : 0;
    // The next issue in front, the ones after it in reading order fanned out behind (like the Events cards)
    const stack = next ? [next, ...list.items.slice(index + 1, index + 3)] : skipped.slice(0, 3);
    const open = (item: any) => router.push(`/reader?path=${encodeURIComponent(item.issue.filePath)}&series=${encodeURIComponent(item.issue.series.folderPath)}`);
    const page = next?.progress && !next.progress.isCompleted && next.progress.currentPage > 0 && next.progress.totalPages > 0
        ? `Page ${next.progress.currentPage + 1} of ${next.progress.totalPages}` : null;

    return (
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
            {/* Fanned stack spans ~1.8 cover widths: h-56 -> 150 px covers -> ~270 px, so the box is w-72 */}
            <button className="group w-72 shrink-0 py-2" onClick={() => next && open(next)} title={next ? `Read ${label(next)}` : undefined}>
                <FannedCovers covers={stack.map(cover)} className="h-56" />
            </button>
            <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
                <div className="flex items-center gap-2 justify-center sm:justify-start">
                    <Badge className="bg-primary/15 text-primary border-primary/30 shrink-0"><ListOrdered className="w-3 h-3 mr-1" /> Reading List</Badge>
                    <span className="text-xs font-bold text-muted-foreground">{read} / {list.items.length} read</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight">{displayName(list.name)}</h2>
                {next && (
                    <div>
                        <p className="text-xs uppercase tracking-widest font-bold text-muted-foreground">Up next</p>
                        <p className="text-lg font-bold">{label(next)}</p>
                        {page && <p className="text-xs text-muted-foreground">{page}</p>}
                    </div>
                )}
                <div className="h-1.5 w-full max-w-md rounded-full bg-muted overflow-hidden mx-auto sm:mx-0"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                {skipped.length > 0 && (
                    <div className="flex items-start gap-2 text-sm rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 px-3 py-2 text-left max-w-xl">
                        <Info className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                            <b>{skipped.length} missing</b> before this ({skipped.slice(0, 3).map(label).join(', ')}{skipped.length > 3 ? ', …' : ''}).
                            {next ? <> Continuing with the next one you have.</> : <> Request them in the list to keep reading.</>}
                        </span>
                    </div>
                )}
                <div className="flex flex-wrap gap-2 justify-center sm:justify-start pt-1">
                    {next && <Button className="font-bold" onClick={() => open(next)}><BookOpen className="w-4 h-4 mr-2" /> {read > 0 || next.progress ? 'Continue' : 'Start'}</Button>}
                    <Button asChild variant="outline" className="font-bold border-primary/50 text-primary hover:bg-primary/10">
                        <Link href={`/reading-lists?id=${list.id}`}>Open List <ArrowRight className="w-4 h-4 ml-1" /></Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
