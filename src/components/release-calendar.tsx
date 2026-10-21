// Fork only: day / week / month / year release calendar with Batcave-style publisher filter.
"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ImageIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/list-cards"
import { normalizePublisher } from "@/lib/reading-list-groups"
import { type CalendarView, daysBetween, globalWeekOffsets, iso, parseDay, rangeFor, shift } from "@/lib/calendar-range"

export type Release = {
    id: string | number, seriesName: string, issueNumber: string, publisher: string, releaseDate: string,
    coverUrl: string | null, seriesPath?: string, libraryState?: string, inLibrary?: boolean,
}
type Source = 'followed' | 'tracked' | 'global'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pub = (r: Release) => normalizePublisher(r.publisher) || 'Other'
const isFirst = (r: Release) => /^0*1$/.test(r.issueNumber || '')
const owned = (r: Release) => r.libraryState === 'IN_LIBRARY' || r.inLibrary

async function load(source: Source, from: string, to: string): Promise<Release[]> {
    if (source !== 'global') {
        const res = await fetch(`/api/calendar?weekOffset=0&from=${from}&to=${to}${source === 'followed' ? '&scope=followed' : ''}`)
        return res.ok ? (await res.json()).releases || [] : []
    }
    // Metron only serves whole Sunday–Saturday weeks (cached per week on the server): fetch them in turn
    const seen = new Map<string, Release>()
    for (const w of globalWeekOffsets(from, to, new Date())) {
        const res = await fetch(`/api/calendar/global?weekOffset=${w}`)
        const data = res.ok ? await res.json() : {}
        for (const r of (data.releases || []) as Release[]) seen.set(String(r.id), r)
    }
    return [...seen.values()].filter(r => r.releaseDate >= from && r.releaseDate <= to)
}

function Cover({ r, size }: { r: Release, size: 'sm' | 'md' | 'lg' }) {
    const body = (
        <div className="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-muted border border-border" title={`${r.seriesName} #${r.issueNumber}`}>
            {r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" className="w-full h-full object-cover" /> : <ImageIcon className="w-4 h-4 m-auto h-full text-muted-foreground/40" />}
            {size !== 'sm' && (
                <span className={`absolute bottom-1 left-1 text-[10px] font-black px-1.5 py-0.5 rounded ${isFirst(r) ? 'bg-pink-600 text-white' : 'bg-black/70 text-white'}`}>#{r.issueNumber}</span>
            )}
            {size !== 'sm' && owned(r) && <span className="absolute top-1 right-1 text-[9px] font-bold px-1 rounded bg-emerald-500 text-white">OWNED</span>}
        </div>
    )
    return r.seriesPath ? <Link href={`/library/series?path=${encodeURIComponent(r.seriesPath)}`}>{body}</Link> : body
}

/** One compact line "Series #N" for week and month cells: many more fit than covers. */
function Line({ r }: { r: Release }) {
    const text = (
        <span className={`block truncate text-[11px] leading-snug px-1 rounded ${owned(r) ? 'text-emerald-500' : 'text-foreground'} hover:bg-muted`} title={`${r.seriesName} #${r.issueNumber} (${pub(r)})`}>
            {isFirst(r) && <span className="mr-1 text-[9px] font-black px-1 rounded bg-pink-600 text-white">#1</span>}
            {r.seriesName} <span className="text-muted-foreground">#{r.issueNumber}</span>
        </span>
    )
    return r.seriesPath ? <Link href={`/library/series?path=${encodeURIComponent(r.seriesPath)}`} onClick={e => e.stopPropagation()}>{text}</Link> : text
}

export function ReleaseCalendar({ source, view, onViewChange }: { source: Source, view: CalendarView, onViewChange: (v: CalendarView) => void }) {
    const [anchor, setAnchor] = useState(() => parseDay(iso(new Date())))
    const [releases, setReleases] = useState<Release[] | null>(null)
    const [publisher, setPublisher] = useState('All')
    const range = useMemo(() => rangeFor(view, anchor), [view, anchor])
    const yearBlocked = source === 'global' && view === 'year'

    useEffect(() => {
        if (yearBlocked) { setReleases([]); return }
        let cancelled = false
        setReleases(null)
        load(source, range.from, range.to).then(r => { if (!cancelled) setReleases(r) })
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

    const title = view === 'day' ? anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        : view === 'week' ? `${parseDay(range.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${parseDay(range.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
        : view === 'month' ? `${MONTHS[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}` : String(anchor.getUTCFullYear())
    const open = (day: string, v: CalendarView) => { setAnchor(parseDay(day)); onViewChange(v) }
    const today = iso(new Date())

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 bg-muted/50 p-3 rounded-xl border border-border">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setAnchor(a => shift(view, a, -1))}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setAnchor(a => shift(view, a, 1))}><ChevronRight className="w-4 h-4" /></Button>
                <Button variant="ghost" size="sm" className="font-bold" onClick={() => setAnchor(parseDay(today))}>Today</Button>
                <h2 className="text-lg font-black ml-1">{title}</h2>
                <div className="flex-1" />
                <div className="flex gap-1 bg-background p-1 rounded-md border border-border">
                    {(['day', 'week', 'month', 'year'] as CalendarView[]).map(v => (
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

            {yearBlocked ? (
                <p className="text-center text-muted-foreground py-16">The year view needs ~50 Metron requests for the global list. Use it on <b>My Pull List</b> or <b>Tracked Series</b>, or switch to month.</p>
            ) : releases === null ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : view === 'day' ? (
                shown.length === 0 ? <p className="text-center text-muted-foreground italic py-16">No releases on this day.</p> : (
                    <div className="space-y-8">
                        {(publisher === 'All' ? counts.map(c => c[0]) : [publisher]).map(p => {
                            const list = shown.filter(r => pub(r) === p)
                            if (!list.length) return null
                            return (
                                <section key={p} className="space-y-3">
                                    <h3 className="text-xl font-black">{p} <span className="text-muted-foreground font-bold text-base">— {list.length} new issue{list.length > 1 ? 's' : ''}</span></h3>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                                        {list.map(r => <div key={r.id} className="space-y-1"><Cover r={r} size="lg" /><p className="text-[11px] font-bold leading-tight line-clamp-2">{r.seriesName}</p></div>)}
                                    </div>
                                </section>
                            )
                        })}
                    </div>
                )
            ) : view === 'week' ? (
                <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                    {daysBetween(range.from, range.to).map((day, i) => {
                        const list = byDay.get(day) || []
                        return (
                            <div key={day} className={`rounded-lg border p-2 min-h-32 ${day === today ? 'border-primary bg-primary/5' : 'border-border bg-card/40'}`}>
                                <button onClick={() => open(day, 'day')} className="w-full flex items-baseline justify-between mb-2 hover:text-primary">
                                    <span className="text-xs font-black uppercase">{WEEKDAYS[i]}</span>
                                    <span className="text-xs text-muted-foreground">{parseDay(day).getUTCDate()}. {list.length > 0 && `· ${list.length}`}</span>
                                </button>
                                <div className="space-y-0.5">{list.map(r => <Line key={r.id} r={r} />)}</div>
                            </div>
                        )
                    })}
                </div>
            ) : view === 'month' ? (
                <div className="grid grid-cols-7 gap-1">
                    {WEEKDAYS.map(w => <div key={w} className="text-[11px] font-black uppercase text-muted-foreground text-center py-1">{w}</div>)}
                    {daysBetween(range.from, range.to).map(day => {
                        const list = byDay.get(day) || []
                        const inMonth = parseDay(day).getUTCMonth() === anchor.getUTCMonth()
                        return (
                            <button key={day} onClick={() => open(day, 'day')}
                                className={`text-left rounded-md border p-1.5 min-h-24 sm:min-h-28 align-top hover:border-primary/60 ${day === today ? 'border-primary' : 'border-border'} ${inMonth ? 'bg-card/40' : 'opacity-40'}`}>
                                <div className="flex justify-between text-[11px] font-bold"><span>{parseDay(day).getUTCDate()}</span>{list.length > 0 && <span className="text-primary">{list.length}</span>}</div>
                                <div className="mt-1 space-y-0">
                                    {list.slice(0, 8).map(r => <Line key={r.id} r={{ ...r, seriesPath: undefined }} />)}
                                    {list.length > 8 && <span className="text-[10px] text-primary font-bold px-1">+{list.length - 8} more</span>}
                                </div>
                            </button>
                        )
                    })}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {MONTHS.map((m, mi) => {
                        const month = new Date(Date.UTC(anchor.getUTCFullYear(), mi, 1))
                        const r = rangeFor('month', month)
                        const total = daysBetween(`${iso(month).slice(0, 7)}-01`, iso(new Date(Date.UTC(anchor.getUTCFullYear(), mi + 1, 0)))).reduce((n, d) => n + (byDay.get(d)?.length || 0), 0)
                        return (
                            <div key={m} className="rounded-lg border border-border bg-card/40 p-3">
                                <button onClick={() => open(iso(month), 'month')} className="w-full flex justify-between items-baseline mb-2 hover:text-primary">
                                    <span className="font-black">{m}</span><span className="text-xs text-muted-foreground">{total} releases</span>
                                </button>
                                <div className="grid grid-cols-7 gap-0.5">
                                    {daysBetween(r.from, r.to).map(day => {
                                        const n = byDay.get(day)?.length || 0
                                        const inMonth = parseDay(day).getUTCMonth() === mi
                                        const shade = !inMonth ? 'bg-transparent' : n === 0 ? 'bg-muted' : n < 3 ? 'bg-primary/30' : n < 8 ? 'bg-primary/60' : 'bg-primary'
                                        return <button key={day} disabled={!inMonth} title={inMonth ? `${day}: ${n}` : undefined} onClick={() => open(day, 'day')} className={`aspect-square rounded-sm ${shade} ${day === today ? 'ring-1 ring-foreground' : ''}`} />
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
