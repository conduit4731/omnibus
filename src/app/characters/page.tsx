// Fork only: Batcave-style character index built from the character reading lists (A–Z, publisher, portraits).
"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Loader2, Search, Star, User } from "lucide-react"
import { useSession } from "next-auth/react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip, type ListSummary } from "@/components/list-cards"
import { EventTimeline } from "@/components/event-timeline"

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

// Admin: pick one of ComicVine's matches, paste an image URL, or go back to the automatic pick
type Candidate = { name: string, publisher: string | null, deck: string | null, url: string }
function PortraitEditor({ c, onChanged }: { c: Character, onChanged: () => void }) {
    const [open, setOpen] = useState(false)
    const [candidates, setCandidates] = useState<Candidate[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [url, setUrl] = useState("")
    const [saving, setSaving] = useState(false)
    useEffect(() => {
        if (!open || candidates) return
        fetch(`/api/characters/portrait?name=${encodeURIComponent(c.name)}&publisher=${encodeURIComponent(c.publisher)}&candidates=1`)
            .then(r => r.json()).then(d => { setCandidates(d.candidates || []); setError(d.error || null) }).catch(() => setError("ComicVine is not answering right now."))
    }, [open, candidates, c.name, c.publisher])
    const save = async (value: string) => {
        setSaving(true)
        const res = await fetch('/api/characters/portrait', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: c.name, publisher: c.publisher, url: value }) })
        const d = await res.json().catch(() => ({}))
        setSaving(false)
        if (!res.ok) { setError(d.error || 'Could not save.'); return }
        portraits.set(`${c.publisher}:${c.name}`, value ? Promise.resolve(value) : fetch(`/api/characters/portrait?name=${encodeURIComponent(c.name)}&publisher=${encodeURIComponent(c.publisher)}`).then(r => r.json()).then(d => d.url ?? null).catch(() => null))
        setOpen(false); onChanged()
    }
    return (
        <>
            <Button variant="outline" size="sm" className="w-40 sm:w-48 font-bold" onClick={() => setOpen(true)}>Change portrait</Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-2xl w-[95%] max-h-[85vh] overflow-y-auto bg-background border-border">
                    <DialogHeader>
                        <DialogTitle>Portrait for {c.name}</DialogTitle>
                        <DialogDescription>Pick ComicVine's match, or paste an image URL.</DialogDescription>
                    </DialogHeader>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    {candidates === null ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                        : candidates.length === 0 ? <p className="text-sm text-muted-foreground">ComicVine has no pictures for this name.</p> : (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                            {candidates.map(k => (
                                <button key={k.url} disabled={saving} onClick={() => save(k.url)} className="text-left space-y-1 group" title={k.deck || k.name}>
                                    <img src={k.url} alt="" className="w-full aspect-[2/3] object-cover object-top rounded-md border border-border group-hover:ring-2 group-hover:ring-primary" />
                                    <p className="text-[11px] font-bold leading-tight line-clamp-2">{k.name}</p>
                                    <p className="text-[10px] text-muted-foreground line-clamp-1">{k.publisher || '–'}</p>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2 pt-2">
                        <Input placeholder="https://… image URL" value={url} onChange={e => setUrl(e.target.value)} />
                        <Button disabled={saving || !url.trim()} onClick={() => save(url.trim())}>Use URL</Button>
                    </div>
                    <Button variant="ghost" size="sm" className="self-start text-muted-foreground" disabled={saving} onClick={() => save('')}>Reset to automatic</Button>
                </DialogContent>
            </Dialog>
        </>
    )
}

// Star a character: all of its reading lists become favorites and show on the home screen under "Characters"
function FavoriteCharacter({ c }: { c: Character }) {
    const [ids, setIds] = useState<string[] | null>(null)
    const [busy, setBusy] = useState(false)
    useEffect(() => { fetch('/api/reading-lists/favorites').then(r => r.ok ? r.json() : { listIds: [] }).then(d => setIds(d.listIds || [])).catch(() => setIds([])) }, [])
    if (ids === null) return null
    const on = c.lists.every(l => ids.includes(l.id))
    const toggle = async () => {
        setBusy(true)
        let next = ids
        for (const l of c.lists) {
            if (ids.includes(l.id) === !on) continue
            const res = await fetch('/api/reading-lists/favorites', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listId: l.id, favorite: !on }) })
            if (res.ok) next = (await res.json()).listIds || next
        }
        setIds(next)
        setBusy(false)
    }
    return (
        <Button variant={on ? "default" : "outline"} size="sm" className="font-bold" disabled={busy} onClick={toggle}
            title={on ? "Von der Startseite nehmen" : "Auf der Startseite unter „Characters“ zeigen"}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Star className={`w-4 h-4 mr-1.5 ${on ? 'fill-amber-400 text-amber-400' : ''}`} />}
            {on ? "Auf der Startseite" : "Auf die Startseite"}
        </Button>
    )
}

function CharactersContent() {
    const { data: session } = useSession()
    const isAdmin = (session?.user as any)?.role === 'ADMIN'
    const [portraitVersion, setPortraitVersion] = useState(0)
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
                    <div className="space-y-2 shrink-0">
                        <Portrait key={portraitVersion} c={current} className="w-40 sm:w-48 aspect-[2/3] rounded-xl" />
                        {isAdmin && <PortraitEditor c={current} onChanged={() => setPortraitVersion(v => v + 1)} />}
                    </div>
                    <div className="space-y-3">
                        <p className="text-sm font-black uppercase tracking-widest text-primary">{current.publisher}</p>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-4xl font-black">{current.name}</h1>
                            <FavoriteCharacter c={current} />
                        </div>
                        <div className="flex flex-wrap gap-6 text-sm">
                            <div><p className="text-xs uppercase text-muted-foreground">Reading orders</p><p className="font-bold">{current.lists.length}</p></div>
                            <div><p className="text-xs uppercase text-muted-foreground">Issues</p><p className="font-bold">{current.issues}</p></div>
                            <div><p className="text-xs uppercase text-muted-foreground">Owned</p><p className="font-bold">{current.owned}</p></div>
                            <div><p className="text-xs uppercase text-muted-foreground">Read</p><p className="font-bold">{current.read}</p></div>
                        </div>
                    </div>
                </div>
                {/* Chronologisch unter Ära-Überschriften, mit Request / GetComics / Batcave pro Leseliste (wie Events → Timeline) */}
                <EventTimeline events={current.lists} />
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
