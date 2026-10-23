// Fork only: day / week / month / year release calendar with Batcave-style publisher filter.
"use client"

import { BatcaveButton, GetComicsButton } from "@/components/batcave-button"
import { deDate, deDayMonth, DE_MONTHS } from "@/lib/date-de"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { Chip } from "@/components/list-cards"
import { normalizePublisher } from "@/lib/reading-list-groups"
import { type CalendarView, chunks, daysBetween, iso, monthGrid, parseDay, rangeFor, shift } from "@/lib/calendar-range"

export type Release = {
    id: string | number, seriesName: string, issueNumber: string, publisher: string, releaseDate: string,
    coverUrl: string | null, seriesPath?: string, libraryState?: string, inLibrary?: boolean,
    volumeId?: string | number | null, metadataSource?: string, year?: string,  // global pull list: the provider series
}
type Source = 'followed' | 'tracked' | 'global'

const MONTHS = DE_MONTHS
const pub = (r: Release) => normalizePublisher(r.publisher) || 'Other'
const isFirst = (r: Release) => /^0*1$/.test(r.issueNumber || '')
const owned = (r: Release) => r.libraryState === 'IN_LIBRARY' || r.inLibrary

async function load(source: Source, from: string, to: string): Promise<Release[]> {
    if (source !== 'global') {
        const res = await fetch(`/api/calendar?weekOffset=0&from=${from}&to=${to}${source === 'followed' ? '&scope=followed' : ''}`)
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load releases.')
        return (await res.json()).releases || []
    }
    // The global pull list takes the whole range in one Metron pass (a month view = one call; server-cached)
    const seen = new Map<string, Release>()
    for (const c of chunks(from, to, 42)) {
        const res = await fetch(`/api/calendar/global?from=${c.from}&to=${c.to}`)
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load the global pull list.')
        for (const r of ((await res.json()).releases || []) as Release[]) seen.set(String(r.id), r)
    }
    return [...seen.values()].filter(r => r.releaseDate >= from && r.releaseDate <= to)
}

// A release of a series in the library opens it; any other opens the request dialog (onPick)
function Opener({ r, onPick, children }: { r: Release, onPick?: (r: Release) => void, children: React.ReactNode }) {
    if (r.seriesPath) return <Link href={`/library/series?path=${encodeURIComponent(r.seriesPath)}`} onClick={e => e.stopPropagation()}>{children}</Link>
    if (onPick) return <button type="button" className="block w-full text-left" onClick={e => { e.stopPropagation(); onPick(r) }}>{children}</button>
    return <>{children}</>
}

function Cover({ r, size, onPick }: { r: Release, size: 'sm' | 'md' | 'lg', onPick?: (r: Release) => void }) {
    const body = (
        <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-muted border border-border" title={`${r.seriesName} #${r.issueNumber}`}>
            {r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" className="w-full h-full object-cover" /> : <ImageIcon className="w-4 h-4 m-auto h-full text-muted-foreground/40" />}
            {size !== 'sm' && (
                <span className={`absolute bottom-1 left-1 text-[10px] font-black px-1.5 py-0.5 rounded ${isFirst(r) ? 'bg-pink-600 text-white' : 'bg-black/70 text-white'}`}>#{r.issueNumber}</span>
            )}
            {size !== 'sm' && owned(r) && <span className="absolute top-1 right-1 text-[9px] font-bold px-1 rounded bg-emerald-500 text-white">OWNED</span>}
        </div>
    )
    return <Opener r={r} onPick={onPick}>{body}</Opener>
}

/** One compact line "Series #N" for week and month cells: many more fit than covers. */
function Line({ r, onPick }: { r: Release, onPick?: (r: Release) => void }) {
    const text = (
        <span className={`block truncate text-[11px] leading-snug px-1 rounded ${owned(r) ? 'text-emerald-500' : 'text-foreground'} hover:bg-muted`} title={`${r.seriesName} #${r.issueNumber} (${pub(r)})`}>
            {isFirst(r) && <span className="mr-1 text-[9px] font-black px-1 rounded bg-pink-600 text-white">#1</span>}
            {r.seriesName} <span className="text-muted-foreground">#{r.issueNumber}</span>
        </span>
    )
    return <Opener r={r} onPick={onPick}>{text}</Opener>
}

/** A release whose series isn't in the library: subscribe to the series (then open it and request its
 *  issues there) or request just this issue. */
function ReleaseDialog({ r, onClose }: { r: Release | null, onClose: () => void }) {
    const { toast } = useToast()
    const [busy, setBusy] = useState<'series' | 'issue' | null>(null)
    const [subscribed, setSubscribed] = useState(false)
    useEffect(() => { setSubscribed(false) }, [r])
    if (!r) return null
    const request = async (type: 'volume' | 'issue', directSource?: 'getcomics') => {
        setBusy(type === 'volume' ? 'series' : 'issue')
        const res = await fetch('/api/request', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(type === 'volume'
                ? { cvId: r.volumeId, name: r.seriesName, year: r.year, publisher: r.publisher, image: r.coverUrl, type, monitored: true, monitorOnly: true, metadataSource: r.metadataSource || 'METRON' }
                : { cvId: r.volumeId, name: `${r.seriesName} #${r.issueNumber}`, year: r.year, publisher: r.publisher, image: r.coverUrl, type, issueNumber: r.issueNumber, metadataSource: r.metadataSource || 'METRON', releaseDate: r.releaseDate, directSource }),
        }).catch(() => null)
        const data = res ? await res.json().catch(() => ({})) : {}
        setBusy(null)
        if (!res?.ok) { toast({ title: "Request failed", description: data.error || "The server returned an error.", variant: "destructive" }); return }
        toast({ title: type === 'volume' ? "Subscribed" : "Requested", description: data.message })
        if (type === 'volume') setSubscribed(true); else onClose()
    }
    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent className="sm:max-w-md w-[95%] bg-background border-border rounded-xl">
                <DialogHeader>
                    <DialogTitle>{r.seriesName} #{r.issueNumber}</DialogTitle>
                    <DialogDescription>{r.publisher} · {deDate(r.releaseDate)}{r.year ? ` · series started ${r.year}` : ''} · not in your library yet</DialogDescription>
                </DialogHeader>
                <div className="flex gap-4">
                    <div className="w-28 shrink-0 aspect-[2/3] rounded-md overflow-hidden bg-muted border border-border">
                        {r.coverUrl && <img src={r.coverUrl} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                        {subscribed ? (
                            <Button asChild className="font-bold"><Link href={`/library?q=${encodeURIComponent(r.seriesName)}`}>Open series</Link></Button>
                        ) : (
                            <Button className="font-bold" disabled={busy !== null || !r.volumeId} onClick={() => request('volume')}>
                                {busy === 'series' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Subscribe to series
                            </Button>
                        )}
                        <Button variant="outline" className="font-bold" disabled={busy !== null || !r.volumeId} onClick={() => request('issue')}>
                            {busy === 'issue' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Request this issue
                        </Button>
                        {r.volumeId && (
                            <div className="flex gap-2">
                                <GetComicsButton disabled={busy !== null} onClick={() => request('issue', 'getcomics')} />
                                <BatcaveButton body={{ cvId: r.volumeId, metadataSource: r.metadataSource || 'METRON', issues: [{ number: r.issueNumber }] }} />
                            </div>
                        )}
                        {typeof r.id === 'number' && (
                            <Button variant="ghost" asChild className="text-muted-foreground"><a href={`https://metron.cloud/issue/${r.id}/`} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 mr-2" />Details on Metron</a></Button>
                        )}
                        <p className="text-xs text-muted-foreground">Subscribing adds the series to your library and watches new issues; open it to request the earlier ones.</p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function ReleaseCalendar({ source, view, onViewChange }: { source: Source, view: CalendarView, onViewChange: (v: CalendarView) => void }) {
    const [anchor, setAnchor] = useState(() => parseDay(iso(new Date())))
    const [releases, setReleases] = useState<Release[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [picked, setPicked] = useState<Release | null>(null)
    const [publisher, setPublisher] = useState('All')
    const range = useMemo(() => rangeFor(view, anchor), [view, anchor])
    const yearBlocked = source === 'global' && view === 'year'

    useEffect(() => {
        if (yearBlocked) { setReleases([]); return }
        let cancelled = false
        setReleases(null); setError(null)
        load(source, range.from, range.to)
            .then(r => { if (!cancelled) setReleases(r) })
            .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setReleases([]) } })
        return () => { cancelled = true }
    }, [source, range.from, range.to, yearBlocked])

    const all = releases || []
    const counts = useMemo(() => {
        const m = new Map<string, number>()
        for (const r of all) m.set(pub(r), (m.get(pub(r)) || 0) + 1)
        return [...m].sort((a, b) => b[1] - a[1])
    }, [all])
    const shown = publisher === 'All' ? all : all.filter(r => pub(r) === publisher)
    const byDay = useMemo(() => {
        const m = new Map<string, Release[]>()
        for (const r of shown) m.set(r.releaseDate.slice(0, 10), [...(m.get(r.releaseDate.slice(0, 10)) || []), r])
        return m
    }, [shown])

    const title = view === 'year' ? String(anchor.getUTCFullYear())
        : `Woche ${deDayMonth(range.from)} – ${deDate(range.to)}`
    const open = (day: string, v: CalendarView) => { setAnchor(parseDay(day)); onViewChange(v) }
    const today = iso(new Date())

    return (
        <div className="space-y-5">
            <ReleaseDialog r={picked} onClose={() => setPicked(null)} />
            <div className="flex flex-wrap items-center gap-2 bg-muted/50 p-3 rounded-xl border border-border">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setAnchor(a => shift(view, a, -1))}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setAnchor(a => shift(view, a, 1))}><ChevronRight className="w-4 h-4" /></Button>
                <Button variant="ghost" size="sm" className="font-bold" onClick={() => setAnchor(parseDay(today))}>Today</Button>
                <h2 className="text-lg font-black ml-1">{title}</h2>
                <div className="flex-1" />
                <div className="flex gap-1 bg-background p-1 rounded-md border border-border">
                    {(['covers', 'compact', 'year'] as CalendarView[]).map(v => (
                        <Button key={v} size="sm" variant={view === v ? 'default' : 'ghost'} className="h-7 px-3 text-xs font-bold capitalize" onClick={() => onViewChange(v)}>{v}</Button>
                    ))}
                </div>
            </div>

            {releases && all.length > 0 && (
                <>
                    <p className="text-sm text-muted-foreground">
                        <b className="text-foreground">{all.length} releases</b>
                        {counts.slice(0, 3).map(([p, n]) => <span key={p}>, {n} {p}</span>)}
                        {' · '}<b className="text-foreground">{all.filter(isFirst).length}</b> first issues
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Chip active={publisher === 'All'} onClick={() => setPublisher('All')} label="All" count={all.length} />
                        {counts.map(([p, n]) => <Chip key={p} active={publisher === p} onClick={() => setPublisher(p)} label={p} count={n} />)}
                    </div>
                </>
            )}

            {error ? (
                <div className="py-16 text-center text-sm text-muted-foreground">{error}</div>
            ) : yearBlocked ? (
                <p className="text-center text-muted-foreground py-16">The year view needs ~50 Metron requests for the global list. Use it on <b>My Pull List</b> or <b>Tracked Series</b>, or use Covers / Compact.</p>
            ) : releases === null ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : view === 'covers' ? (
                shown.length === 0 ? <p className="text-center text-muted-foreground italic py-16">No releases this week.</p> : (
                    <div className="space-y-8">
                        {(publisher === 'All' ? counts.map(c => c[0]) : [publisher]).map(p => {
                            const list = shown.filter(r => pub(r) === p)
                            if (!list.length) return null
                            return (
                                <section key={p} className="space-y-3">
                                    <h3 className="text-xl font-black">{p} <span className="text-muted-foreground font-bold text-base">— {list.length} new issue{list.length > 1 ? 's' : ''}</span></h3>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                                        {list.map(r => <div key={r.id} className="space-y-1"><Cover r={r} size="lg" onPick={setPicked} /><p className="text-[11px] font-bold leading-tight line-clamp-2">{r.seriesName}</p></div>)}
                                    </div>
                                </section>
                            )
                        })}
                    </div>
                )
            ) : view === 'compact' ? (
                // Nearly everything ships on Wednesday: columns per publisher, not per weekday
                shown.length === 0 ? <p className="text-center text-muted-foreground italic py-16">No releases this week.</p> : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {(publisher === 'All' ? counts.map(c => c[0]) : [publisher]).map(p => {
                            const list = shown.filter(r => pub(r) === p).sort((x, y) => x.seriesName.localeCompare(y.seriesName))
                            if (!list.length) return null
                            return (
                                <div key={p} className="rounded-lg border border-border bg-card/40 p-2">
                                    <div className="flex items-baseline justify-between mb-2 px-1"><span className="text-xs font-black uppercase">{p}</span><span className="text-xs text-muted-foreground">{list.length}</span></div>
                                    <div className="space-y-0.5">{list.map(r => <Line key={r.id} r={r} onPick={setPicked} />)}</div>
                                </div>
                            )
                        })}
                    </div>
                )
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {MONTHS.map((m, mi) => {
                        const month = new Date(Date.UTC(anchor.getUTCFullYear(), mi, 1))
                        const r = monthGrid(month)
                        const total = daysBetween(`${iso(month).slice(0, 7)}-01`, iso(new Date(Date.UTC(anchor.getUTCFullYear(), mi + 1, 0)))).reduce((n, d) => n + (byDay.get(d)?.length || 0), 0)
                        return (
                            <div key={m} className="rounded-lg border border-border bg-card/40 p-3">
                                <button onClick={() => open(iso(month), 'covers')} className="w-full flex justify-between items-baseline mb-2 hover:text-primary">
                                    <span className="font-black">{m}</span><span className="text-xs text-muted-foreground">{total} releases</span>
                                </button>
                                <div className="grid grid-cols-7 gap-0.5">
                                    {daysBetween(r.from, r.to).map(day => {
                                        const n = byDay.get(day)?.length || 0
                                        const inMonth = parseDay(day).getUTCMonth() === mi
                                        const shade = !inMonth ? 'bg-transparent' : n === 0 ? 'bg-muted' : n < 3 ? 'bg-primary/30' : n < 8 ? 'bg-primary/60' : 'bg-primary'
                                        return <button key={day} disabled={!inMonth} title={inMonth ? `${day}: ${n}` : undefined} onClick={() => open(day, 'covers')} className={`aspect-square rounded-sm ${shade} ${day === today ? 'ring-1 ring-foreground' : ''}`} />
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
