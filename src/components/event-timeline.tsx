"use client"

// Fork only: every event in chronological order as a table — years, publisher, era, size, what you own and have
// read, ongoing or ended — with a button that starts or continues reading it (the list's next owned unread issue).
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BookOpen, ListOrdered, Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { Chip, displayName, type ListSummary } from "@/components/list-cards"
import { nextInList } from "@/lib/reading-list-next"
import { cn } from "@/lib/utils"

export type EventStatus = 'Complete' | 'Ongoing' | 'Ended'
/** Complete = every issue owned; otherwise Ongoing while issues still come out this year or later. */
export function eventStatus(l: Pick<ListSummary, 'itemCount' | 'ownedCount' | 'to'>, year = new Date().getFullYear()): EventStatus {
    if (l.itemCount > 0 && l.ownedCount >= l.itemCount) return 'Complete'
    return (l.to ?? 0) >= year ? 'Ongoing' : 'Ended'
}

/** Chronological: by first year, then last year, then name; lists without years last. */
export function chronological<T extends Pick<ListSummary, 'from' | 'to' | 'name'>>(lists: T[]): T[] {
    return [...lists].sort((a, b) => (a.from ?? 9999) - (b.from ?? 9999) || (a.to ?? 9999) - (b.to ?? 9999) || a.name.localeCompare(b.name))
}

const STATUS_STYLE: Record<EventStatus, string> = { Complete: 'bg-violet-600', Ongoing: 'bg-sky-600', Ended: 'bg-zinc-600' }

function ReadButton({ l }: { l: ListSummary }) {
    const router = useRouter()
    const { toast } = useToast()
    const [busy, setBusy] = useState(false)
    if (l.ownedCount === 0) return <Button size="sm" variant="ghost" className="h-8 text-xs" asChild><Link href={`/reading-lists?id=${l.id}`}>Open</Link></Button>
    const go = async () => {
        setBusy(true)
        const d = await fetch(`/api/reading-lists?id=${encodeURIComponent(l.id)}`).then(r => r.ok ? r.json() : null).catch(() => null)
        setBusy(false)
        const { item } = nextInList<any>(d?.items || [])
        if (item?.issue?.filePath) router.push(`/reader?path=${encodeURIComponent(item.issue.filePath)}&series=${encodeURIComponent(item.issue.series.folderPath)}`)
        else toast({ title: displayName(l.name), description: d ? "Nothing left to read that you own." : "Could not load the list." })
    }
    return (
        <Button size="sm" className="h-8 text-xs font-bold" disabled={busy} onClick={go}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}{l.readCount > 0 ? 'Continue' : 'Start'}
        </Button>
    )
}

export function EventTimeline({ events }: { events: ListSummary[] }) {
    const [open, setOpen] = useState(false)
    const [publisher, setPublisher] = useState('All')
    const [ownedOnly, setOwnedOnly] = useState(false)
    const publishers = useMemo(() => [...new Set(events.map(e => e.publisher))].sort(), [events])
    const rows = useMemo(() => chronological(events.filter(e => (publisher === 'All' || e.publisher === publisher) && (!ownedOnly || e.ownedCount > 0))),
        [events, publisher, ownedOnly])

    return (
        <>
            <Button variant="outline" className="rounded-full font-bold h-9" onClick={() => setOpen(true)}><ListOrdered className="w-4 h-4 mr-2" /> Timeline</Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-6xl w-[96%] max-h-[90vh] flex flex-col bg-background border-border">
                    <DialogHeader>
                        <DialogTitle>Events in chronological order</DialogTitle>
                        <DialogDescription>{rows.length} events · first to last year of their issues · owned and read from your library</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-wrap gap-2">
                        <Chip active={publisher === 'All'} onClick={() => setPublisher('All')} label="All" count={events.length} />
                        {publishers.map(p => <Chip key={p} active={publisher === p} onClick={() => setPublisher(p)} label={p} count={events.filter(e => e.publisher === p).length} />)}
                        <Chip active={ownedOnly} onClick={() => setOwnedOnly(o => !o)} label="Only with owned issues" count={events.filter(e => e.ownedCount > 0).length} />
                    </div>
                    <div className="overflow-auto -mx-6 px-6">
                        <table className="w-full text-sm">
                            <thead className="text-xs text-muted-foreground uppercase sticky top-0 bg-background">
                                <tr className="border-b border-border text-left">
                                    <th className="py-2 pr-3">Years</th><th className="py-2 pr-3">Event</th>
                                    <th className="py-2 pr-3 hidden md:table-cell">Publisher</th><th className="py-2 pr-3 hidden lg:table-cell">Era</th>
                                    <th className="py-2 pr-3 text-right">Issues</th><th className="py-2 pr-3 w-40">Owned</th>
                                    <th className="py-2 pr-3 text-right hidden sm:table-cell">Read</th><th className="py-2 pr-3">Status</th><th className="py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {rows.map(l => {
                                    const st = eventStatus(l)
                                    const pct = l.itemCount ? Math.round(100 * l.ownedCount / l.itemCount) : 0
                                    return (
                                        <tr key={l.id} className="hover:bg-muted/40">
                                            <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground font-mono text-xs">{l.from ? (l.to && l.to !== l.from ? `${l.from}–${l.to}` : l.from) : '–'}</td>
                                            <td className="py-2 pr-3 font-bold"><Link href={`/reading-lists?id=${l.id}`} className="hover:text-primary">{displayName(l.name)}</Link></td>
                                            <td className="py-2 pr-3 hidden md:table-cell text-muted-foreground">{l.publisher}</td>
                                            <td className="py-2 pr-3 hidden lg:table-cell text-muted-foreground">{l.era}</td>
                                            <td className="py-2 pr-3 text-right">{l.itemCount}</td>
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                                                    <span className="text-xs text-muted-foreground w-16 text-right">{l.ownedCount}/{l.itemCount}</span>
                                                </div>
                                            </td>
                                            <td className="py-2 pr-3 text-right hidden sm:table-cell">{l.readCount > 0 ? <span className="inline-flex items-center gap-1"><BookOpen className="w-3 h-3" />{l.readCount}</span> : '–'}</td>
                                            <td className="py-2 pr-3"><span className={cn("text-[10px] font-black uppercase tracking-wider text-white px-1.5 py-0.5 rounded", STATUS_STYLE[st])}>{st}</span></td>
                                            <td className="py-2 text-right"><ReadButton l={l} /></td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
