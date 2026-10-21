// Fork only: Batcave-style character index built from the character reading lists (A–Z, publisher, portraits).
"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Loader2, Search, User } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Chip, ListCard, type ListSummary } from "@/components/list-cards"

type Character = { key: string, name: string, publisher: string, lists: ListSummary[], issues: number, owned: number, read: number }

// ComicVine allows ~200 requests an hour: fetch portraits one at a time, only for cards on screen
let queue: Promise<unknown> = Promise.resolve()
const portraits = new Map<string, Promise<string | null>>()
function portrait(name: string, publisher: string) {
    const key = `${publisher}:${name}`
    if (!portraits.has(key)) {
        const p = queue.then(() => fetch(`/api/characters/portrait?name=${encodeURIComponent(name)}&publisher=${encodeURIComponent(publisher)}`)
            .then(r => r.ok ? r.json() : { url: null }).then(d => d.url as string | null).catch(() => null))
        queue = p
        portraits.set(key, p)
    }
    return portraits.get(key)!
}

function Portrait({ c, className }: { c: Character, className: string }) {
    const ref = useRef<HTMLDivElement>(null)
    const [url, setUrl] = useState<string | null | undefined>(undefined)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(([e]) => {
            if (e.isIntersecting) { io.disconnect(); portrait(c.name, c.publisher).then(setUrl) }
        }, { rootMargin: "300px" })
        io.observe(el)
        return () => io.disconnect()
    }, [c.name, c.publisher])
    const fallback = c.lists.find(l => l.covers[0])?.covers[0]
    const src = url || (url === null ? fallback : undefined)
    return (
        <div ref={ref} className={`bg-muted overflow-hidden ${className}`}>
            {src ? <img src={src} alt={c.name} className="w-full h-full object-cover object-top" />
                : <div className="w-full h-full flex items-center justify-center"><User className="w-10 h-10 text-muted-foreground/30" /></div>}
        </div>
    )
}

function CharactersContent() {
    const params = useSearchParams()
    const selected = params.get("c")
    const [lists, setLists] = useState<ListSummary[] | null>(null)
    const [letter, setLetter] = useState("All")
    const [publisher, setPublisher] = useState("All")
    const [query, setQuery] = useState("")

    useEffect(() => {
        fetch('/api/reading-lists').then(r => r.ok ? r.json() : []).then((all: ListSummary[]) => setLists(all.filter(l => l.category === 'Characters' && l.subject)))
    }, [])

    const characters = useMemo(() => {
        const m = new Map<string, Character>()
        for (const l of lists || []) {
            const key = `${l.publisher}:${l.subject}`
            const c = m.get(key) || { key, name: l.subject!, publisher: l.publisher, lists: [], issues: 0, owned: 0, read: 0 }
            c.lists.push(l); c.issues += l.itemCount; c.owned += l.ownedCount; c.read += l.readCount
            m.set(key, c)
        }
        return [...m.values()].sort((a, b) => b.lists.length - a.lists.length || b.issues - a.issues)
    }, [lists])

    if (lists === null) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>

    const current = selected ? characters.find(c => c.key === selected) : null
    if (current) {
        return (
            <div className="container mx-auto py-10 px-6 max-w-[1400px] space-y-8">
                <Link href="/characters" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Characters</Link>
                <div className="flex flex-col sm:flex-row gap-6 rounded-2xl border border-border bg-card/60 p-6">
                    <Portrait c={current} className="w-40 sm:w-48 aspect-[2/3] rounded-xl shrink-0" />
                    <div className="space-y-3">
                        <p className="text-sm font-black uppercase tracking-widest text-primary">{current.publisher}</p>
                        <h1 className="text-4xl font-black">{current.name}</h1>
                        <div className="flex flex-wrap gap-6 text-sm">
                            <div><p className="text-xs uppercase text-muted-foreground">Reading orders</p><p className="font-bold">{current.lists.length}</p></div>
                            <div><p className="text-xs uppercase text-muted-foreground">Issues</p><p className="font-bold">{current.issues}</p></div>
                            <div><p className="text-xs uppercase text-muted-foreground">Owned</p><p className="font-bold">{current.owned}</p></div>
                            <div><p className="text-xs uppercase text-muted-foreground">Read</p><p className="font-bold">{current.read}</p></div>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
                    {[...current.lists].sort((a, b) => a.eraStart - b.eraStart || a.name.localeCompare(b.name)).map(l => <ListCard key={l.id} list={l} />)}
                </div>
            </div>
        )
    }

    const letters = ["All", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    const publishers = [...new Set(characters.map(c => c.publisher))]
    const q = query.trim().toLowerCase()
    const shown = characters.filter(c => (letter === "All" || c.name.toUpperCase().startsWith(letter))
        && (publisher === "All" || c.publisher === publisher) && (!q || c.name.toLowerCase().includes(q)))

    return (
        <div className="container mx-auto py-10 px-6 max-w-[1400px] space-y-6">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold flex items-center gap-3">Characters <span className="text-sm font-bold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">{characters.length}</span></h1>
                <p className="text-muted-foreground max-w-2xl">Every hero and team with a reading order. Pick one to see all of their reading orders, from the oldest era to today.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {letters.map(l => (
                    <button key={l} onClick={() => setLetter(l)} className={`h-8 min-w-8 px-2 rounded-md text-sm font-bold ${letter === l ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>{l}</button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Chip active={publisher === "All"} onClick={() => setPublisher("All")} label="All" count={characters.length} />
                {publishers.map(p => <Chip key={p} active={publisher === p} onClick={() => setPublisher(p)} label={p} count={characters.filter(c => c.publisher === p).length} />)}
                <div className="flex-1" />
                <div className="relative w-full sm:w-60">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search characters…" className="pl-9 rounded-full h-9" />
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
                {shown.map(c => (
                    <Link key={c.key} href={`/characters?c=${encodeURIComponent(c.key)}`} className="group space-y-2">
                        <Portrait c={c} className="aspect-[2/3] rounded-xl transition-transform duration-300 group-hover:scale-[1.02]" />
                        <div>
                            <p className="font-bold leading-tight">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.publisher}</p>
                            <p className="text-xs font-bold text-primary">{c.lists.length} reading order{c.lists.length > 1 ? 's' : ''} · {c.owned}/{c.issues} owned</p>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    )
}

export default function CharactersPage() {
    return <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}><CharactersContent /></Suspense>
}
