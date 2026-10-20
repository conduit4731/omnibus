// Fork only: pick a reading list by publisher → era instead of scrolling a sidebar of every list.
"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Globe, Search, Star } from "lucide-react"

export type ListSummary = {
    id: string, name: string, isGlobal?: boolean, user?: { username: string } | null,
    itemCount: number, ownedCount: number, readCount: number,
    publisher: string, category: string, era: string, eraStart: number,
}

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    lists: ListSummary[]
    activeId: string | null
    mainId: string | null
    onSelect: (id: string) => void
    onSetMain: (id: string | null) => void
}

const pct = (n: number, of: number) => (of ? Math.round(100 * n / of) : 0)

export function ReadingListPicker({ open, onOpenChange, lists, activeId, mainId, onSelect, onSetMain }: Props) {
    const [query, setQuery] = useState("")
    const [publisher, setPublisher] = useState<string>("All")

    // Publishers by list count, "Other" last
    const publishers = useMemo(() => {
        const counts = new Map<string, number>()
        for (const l of lists) counts.set(l.publisher, (counts.get(l.publisher) || 0) + 1)
        return [...counts].sort((a, b) => (a[0] === 'Other' ? 1 : 0) - (b[0] === 'Other' ? 1 : 0) || b[1] - a[1])
    }, [lists])

    // Sections: era (oldest first), lists inside by name; publisher prefix when showing all publishers
    const sections = useMemo(() => {
        const q = query.trim().toLowerCase()
        const shown = lists.filter(l => (publisher === "All" || l.publisher === publisher)
            && (!q || `${l.name} ${l.category} ${l.era} ${l.publisher}`.toLowerCase().includes(q)))
        const byEra = new Map<string, { title: string, start: number, lists: ListSummary[] }>()
        for (const l of shown) {
            const title = publisher === "All" ? `${l.publisher} · ${l.era}` : l.era
            if (!byEra.has(title)) byEra.set(title, { title, start: l.eraStart, lists: [] })
            byEra.get(title)!.lists.push(l)
        }
        return [...byEra.values()]
            .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
            .map(s => ({ ...s, lists: s.lists.sort((a, b) => a.name.localeCompare(b.name)) }))
    }, [lists, publisher, query])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[760px] max-h-[85vh] flex flex-col bg-background border-border rounded-xl p-0 gap-0">
                <DialogHeader className="p-5 pb-3 space-y-3">
                    <DialogTitle>Choose a reading list</DialogTitle>
                    <DialogDescription>Star one as your main list; it opens by default.</DialogDescription>
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search lists, events, characters, eras…" className="pl-9" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {[["All", lists.length] as [string, number], ...publishers].map(([p, n]) => (
                            <Button key={p} size="sm" variant={publisher === p ? "default" : "outline"} className="h-7 px-3 text-xs font-bold" onClick={() => setPublisher(p)}>
                                {p} <span className="ml-1.5 opacity-60">{n}</span>
                            </Button>
                        ))}
                    </div>
                </DialogHeader>

                <div className="overflow-y-auto px-5 pb-5 space-y-5 border-t border-border pt-4">
                    {sections.length === 0 && <p className="text-sm text-muted-foreground italic text-center py-8">No lists match.</p>}
                    {sections.map(section => (
                        <div key={section.title} className="space-y-1.5">
                            <h4 className="text-xs font-black uppercase tracking-wider text-primary sticky top-0 bg-background py-1">{section.title} <span className="text-muted-foreground font-bold">({section.lists.length})</span></h4>
                            {section.lists.map(l => (
                                <div key={l.id}
                                    onClick={() => { onSelect(l.id); onOpenChange(false) }}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${l.id === activeId ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}>
                                    <button
                                        className="shrink-0 p-1 rounded hover:bg-muted"
                                        title={l.id === mainId ? "Main list (click to unset)" : "Make this my main list"}
                                        onClick={e => { e.stopPropagation(); onSetMain(l.id === mainId ? null : l.id) }}>
                                        <Star className={`w-4 h-4 ${l.id === mainId ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm truncate">{l.name}</span>
                                            {l.isGlobal && <span title={`Global list by ${l.user?.username || 'Unknown'}`}><Globe className="w-3 h-3 text-emerald-500 shrink-0" /></span>}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{l.category}</Badge>
                                            <div className="h-1 w-24 rounded-full bg-muted overflow-hidden" title={`${l.readCount} read of ${l.itemCount}`}>
                                                <div className="h-full bg-primary" style={{ width: `${pct(l.readCount, l.itemCount)}%` }} />
                                            </div>
                                            <span className="text-[10px] text-muted-foreground font-bold">{l.readCount}/{l.itemCount} read · {pct(l.ownedCount, l.itemCount)}% owned</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}
