"use client"

// Fork only: every event in chronological order as a table — years, publisher, era, size, what you own and have
// read, ongoing or ended — with a button that starts or continues reading it (the list's next owned unread issue).
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BookOpen, CloudDownload, Loader2, Play } from "lucide-react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { Chip, displayName, type ListSummary } from "@/components/list-cards"
import { nextInList } from "@/lib/reading-list-next"
import { requestListItem } from "@/lib/request-list-item"
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

/** Chronological rows grouped under era headers (DC: Golden … Dawn of DC, Marvel: Golden … Modern Marvel, others by
 *  decade); eras sorted by start year, shared names (Golden / Silver / Bronze Age) form one group. */
export function byEra<T extends Pick<ListSummary, 'era' | 'eraStart' | 'from' | 'to' | 'name' | 'publisher'>>(lists: T[]) {
    const groups = new Map<string, { era: string, start: number, rows: T[] }>()
    for (const l of lists) {
        const g = groups.get(l.era) || { era: l.era, start: l.eraStart, rows: [] }
        g.start = Math.min(g.start, l.eraStart); g.rows.push(l)
        groups.set(l.era, g)
    }
    return [...groups.values()].sort((a, b) => a.start - b.start || a.era.localeCompare(b.era)).map(g => ({ ...g, rows: chronological(g.rows) }))
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

// Request every entry of the event that has no file yet, one after another (same request as the reading list page)
function RequestMissingButton({ l, onDone }: { l: ListSummary, onDone: () => void }) {
    const { toast } = useToast()
    const [progress, setProgress] = useState<string | null>(null)
    const missing = l.itemCount - l.ownedCount
    if (missing <= 0) return null
    const go = async () => {
        setProgress('…')
        const d = await fetch(`/api/reading-lists?id=${encodeURIComponent(l.id)}`).then(r => r.ok ? r.json() : null).catch(() => null)
        const items = (d?.items || []).filter((i: any) => !i.issue?.filePath)
        let ok = 0
        for (const [n, item] of items.entries()) {
            setProgress(`${n + 1}/${items.length}`)
            try { await requestListItem(item); ok++ } catch { /* counted as failed */ }
            await new Promise(res => setTimeout(res, 300))
        }
        setProgress(null)
        toast({ title: displayName(l.name), description: `Requested ${ok} of ${items.length} missing issues.` })
        onDone()
    }
    return (
        <Button size="sm" variant="outline" className="h-8 text-xs font-bold" disabled={progress !== null} onClick={go} title={`Request the ${missing} issues you don't have`}>
            {progress ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />{progress}</> : <><CloudDownload className="w-3.5 h-3.5 mr-1" />Request {missing}</>}
        </Button>
    )
}

export function EventTimeline({ events }: { events: ListSummary[] }) {
    const { data: session } = useSession()
    const canRequest = (session?.user as any)?.role === 'ADMIN' || !!(session?.user as any)?.canRequest
    const [requested, setRequested] = useState<Set<string>>(new Set())
    const [ownedOnly, setOwnedOnly] = useState(false)
    const publisher = 'All' // the events page filters by publisher; era headers name them under "All"
    const rows = useMemo(() => events.filter(e => !ownedOnly || e.ownedCount > 0), [events, ownedOnly])
    const groups = useMemo(() => byEra(rows), [rows])

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                <Chip active={ownedOnly} onClick={() => setOwnedOnly(o => !o)} label="Only with owned issues" count={events.filter(e => e.ownedCount > 0).length} />
                <span className="text-xs text-muted-foreground">{rows.length} events · years of their issues · owned and read from your library</span>
            </div>
            <div className="rounded-xl border border-border bg-background/80 overflow-x-auto px-3">
                        <table className="w-full text-sm">
                            <thead className="text-xs text-muted-foreground uppercase sticky top-0 bg-background">
                                <tr className="border-b border-border text-left">
                                    <th className="py-2 pr-3">Years</th><th className="py-2 pr-3">Event</th>
                                    <th className="py-2 pr-3 hidden md:table-cell">Publisher</th><th className="py-2 pr-3 hidden lg:table-cell">Era</th>
                                    <th className="py-2 pr-3 text-right">Issues</th><th className="py-2 pr-3 w-40">Owned</th>
                                    <th className="py-2 pr-3 text-right hidden sm:table-cell">Read</th><th className="py-2 pr-3">Status</th><th className="py-2" />
                                </tr>
                            </thead>
                            {groups.map(g => (
                            <tbody key={g.era} className="divide-y divide-border">
                                <tr className="bg-muted/60">
                                    <td colSpan={9} className="py-1.5 px-2 text-xs font-black uppercase tracking-widest text-primary">
                                        {g.era} <span className="text-muted-foreground font-bold normal-case tracking-normal">· {g.start > 0 ? `from ${g.start}` : 'earliest'} · {g.rows.length} {g.rows.length === 1 ? 'event' : 'events'}{publisher === 'All' ? ` · ${[...new Set(g.rows.map(x => x.publisher))].join(', ')}` : ''}</span>
                                    </td>
                                </tr>
                                {g.rows.map(l => {
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
                                            <td className="py-2 text-right whitespace-nowrap">
                                                <div className="inline-flex gap-1.5">
                                                    {canRequest && !requested.has(l.id) && <RequestMissingButton l={l} onDone={() => setRequested(prev => new Set(prev).add(l.id))} />}
                                                    <ReadButton l={l} />
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                            ))}
                        </table>
            </div>
        </div>
    )
}
