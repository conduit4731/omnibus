// Fork only: Batcave-style overview of every event reading list (filter by length, publisher, era).
"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, Zap } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Chip, ListCard, type ListSummary } from "@/components/list-cards"
import { EventTimeline } from "@/components/event-timeline"

// Batcave's buckets: how long reading the whole event takes
const LENGTHS = [
    { label: "An evening", test: (n: number) => n <= 12 },
    { label: "A few nights", test: (n: number) => n > 12 && n <= 40 },
    { label: "A month", test: (n: number) => n > 40 && n <= 150 },
    { label: "The big ones", test: (n: number) => n > 150 },
]

export default function EventsPage() {
    const [lists, setLists] = useState<ListSummary[] | null>(null)
    const [length, setLength] = useState<string | null>(null)
    const [publisher, setPublisher] = useState("All")
    const [era, setEra] = useState("All")
    const [sort, setSort] = useState<"size" | "era" | "name">("size")
    const [query, setQuery] = useState("")

    // Era chips on series pages link here with ?publisher=DC&era=New%2052
    useEffect(() => {
        const p = new URLSearchParams(window.location.search)
        if (p.get('publisher')) setPublisher(p.get('publisher')!)
        if (p.get('era')) setEra(p.get('era')!)
    }, [])

    useEffect(() => {
        fetch('/api/reading-lists').then(r => r.ok ? r.json() : []).then((all: ListSummary[]) => setLists(all.filter(l => l.category === 'Events')))
    }, [])

    const events = lists || []
    const byPublisher = useMemo(() => {
        const m = new Map<string, number>()
        for (const l of events) m.set(l.publisher, (m.get(l.publisher) || 0) + 1)
        return [...m].sort((a, b) => b[1] - a[1])
    }, [events])
    const eras = useMemo(() => [...new Map(events.filter(l => publisher === "All" || l.publisher === publisher)
        .map(l => [l.era, l.eraStart])).entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]), [events, publisher])

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase()
        const bucket = LENGTHS.find(b => b.label === length)
        return events
            .filter(l => (!bucket || bucket.test(l.itemCount)) && (publisher === "All" || l.publisher === publisher)
                && (era === "All" || l.era === era) && (!q || l.name.toLowerCase().includes(q)))
            .sort((a, b) => sort === "size" ? b.itemCount - a.itemCount : sort === "era" ? a.eraStart - b.eraStart || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
    }, [events, length, publisher, era, sort, query])

    return (
        <div className="container mx-auto py-10 px-6 max-w-[1400px] space-y-6">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold flex items-center gap-2"><Zap className="w-7 h-7 text-primary" /> Comic Events</h1>
                <p className="text-muted-foreground max-w-2xl">Crossovers jump between series. Here they are in reading order. Pick one, press Start, and Omnibus keeps track of what comes next.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {LENGTHS.map(b => <Chip key={b.label} active={length === b.label} onClick={() => setLength(length === b.label ? null : b.label)} label={b.label} count={events.filter(l => b.test(l.itemCount)).length} />)}
                <div className="w-px h-6 bg-border mx-1" />
                <Chip active={publisher === "All"} onClick={() => { setPublisher("All"); setEra("All") }} label="All" count={events.length} />
                {byPublisher.map(([p, n]) => <Chip key={p} active={publisher === p} onClick={() => { setPublisher(p); setEra("All") }} label={p} count={n} />)}
                <div className="flex-1" />
                <EventTimeline events={events} />
                <select value={era} onChange={e => setEra(e.target.value)} className="h-9 rounded-full border border-border bg-background px-3 text-sm font-bold">
                    <option value="All">All eras</option>
                    {eras.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="h-9 rounded-full border border-border bg-background px-3 text-sm font-bold">
                    <option value="size">Biggest first</option>
                    <option value="era">Chronological</option>
                    <option value="name">A–Z</option>
                </select>
                <div className="relative w-full sm:w-60">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name…" className="pl-9 rounded-full h-9" />
                </div>
            </div>

            {lists === null ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : shown.length === 0 ? (
                <p className="text-center text-muted-foreground italic py-20">No events match.</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                    {shown.map(l => <ListCard key={l.id} list={l} />)}
                </div>
            )}
        </div>
    )
}
