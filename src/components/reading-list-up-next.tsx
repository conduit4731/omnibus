// Fork only: home screen shelf for the user's main reading list ("Jump Back In" stays for everything else).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, Info, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { nextInList } from "@/lib/reading-list-next";

const SHOWN = 8;

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
    // From the first skipped gap (or the next issue) onwards, in reading order
    const from = skipped.length > 0 ? list.items.indexOf(skipped[0]) : index;
    const shown = list.items.slice(from, from + SHOWN);
    const open = (item: any) => router.push(`/reader?path=${encodeURIComponent(item.issue.filePath)}&series=${encodeURIComponent(item.issue.series.folderPath)}`);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Badge className="bg-primary/15 text-primary border-primary/30 shrink-0"><ListOrdered className="w-3 h-3 mr-1" /> Reading List</Badge>
                        <span className="text-xs font-bold text-muted-foreground">{read} / {list.items.length} read</span>
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground truncate mt-1">{list.name}</h2>
                </div>
                <Button asChild variant="outline" size="sm" className="border-primary/50 text-primary hover:bg-primary/10 group font-bold shrink-0">
                    <Link href={`/reading-lists?id=${list.id}`}>
                        <span>Open List</span> <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                </Button>
            </div>

            {skipped.length > 0 && (
                <div className="flex items-start gap-2 text-sm rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 px-3 py-2">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                        <b>{skipped.length} missing</b> next in the order ({skipped.slice(0, 3).map(label).join(', ')}{skipped.length > 3 ? ', …' : ''}).
                        {next ? <> Continuing with <b>{label(next)}</b>, the next one you have.</> : <> Request them in the list to keep reading.</>}
                    </span>
                </div>
            )}

            <div className="flex overflow-x-auto gap-4 pb-4 pt-2 px-2 snap-x no-scrollbar -mx-2">
                {shown.map((item: any) => {
                    const owned = !!item.issue?.filePath;
                    const isNext = item === next;
                    return (
                        <div
                            key={item.id}
                            onClick={() => owned && open(item)}
                            title={owned ? label(item) : `${label(item)} – not in your library`}
                            className={`group relative flex-none w-[calc(50%-0.5rem)] md:w-[calc(25%-0.75rem)] lg:w-[calc(14.285%-0.857rem)] aspect-[2/3] rounded-lg overflow-hidden border snap-start transition-[transform] duration-200 ${owned ? 'cursor-pointer hover:scale-[1.03] bg-muted' : 'bg-muted/40 border-dashed'} ${isNext ? 'ring-2 ring-primary border-primary' : 'border-border'}`}
                        >
                            <img src={cover(item)} alt="" className={`object-cover w-full h-full ${owned ? '' : 'grayscale opacity-40'}`} />
                            {isNext && <Badge className="absolute top-2 left-2 z-10 bg-primary text-primary-foreground shadow"><BookOpen className="w-3 h-3 mr-1" /> Up next</Badge>}
                            {item.progress?.isCompleted && <Badge className="absolute top-2 left-2 z-10 bg-emerald-600 text-white shadow"><Check className="w-3 h-3 mr-1" /> Read</Badge>}
                            <div className="absolute bottom-0 left-0 w-full p-2.5 bg-linear-to-t from-black/90 via-black/60 to-transparent">
                                <p className="text-white font-bold text-xs line-clamp-2 drop-shadow-md">{label(item)}</p>
                                {!owned && <p className="text-[10px] font-bold uppercase tracking-wider text-orange-400 mt-0.5">Not in library</p>}
                                {owned && !item.progress?.isCompleted && item.progress?.currentPage > 0 && item.progress?.totalPages > 0 && (
                                    <div className="w-full bg-white/30 h-1 rounded-full overflow-hidden mt-1.5">
                                        <div className="bg-primary h-full" style={{ width: `${Math.round(100 * (item.progress.currentPage + 1) / item.progress.totalPages)}%` }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
