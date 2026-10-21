// Fork only: cards for the Events and Characters pages (Batcave-style fanned covers).
"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { BookOpen, ListOrdered } from "lucide-react"

export type ListSummary = {
    id: string, name: string, itemCount: number, ownedCount: number, readCount: number,
    publisher: string, category: string, subject: string | null, era: string, eraStart: number, covers: string[],
}

import { displayListName } from "@/lib/reading-list-groups"
/** "[Marvel] Civil War" -> "Civil War": the publisher is shown under the title anyway. */
export const displayName = displayListName

// Cards without enough library covers ask the server for ComicVine covers: visible cards are collected
// for a moment and sent together (one ComicVine call per 30 lists on the server).
const coverRequests = new Map<string, (covers: string[]) => void>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
function requestCovers(id: string): Promise<string[]> {
    return new Promise(resolve => {
        coverRequests.set(id, resolve)
        if (flushTimer) return
        flushTimer = setTimeout(async function flush() {
            const batch = [...coverRequests.entries()].slice(0, 30)
            batch.forEach(([k]) => coverRequests.delete(k))
            try {
                const res = await fetch('/api/reading-lists/covers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch.map(([k]) => k) }) })
                const data = res.ok ? await res.json() : {}
                batch.forEach(([k, done]) => done(data[k] || []))
            } catch { batch.forEach(([, done]) => done([])) }
            flushTimer = coverRequests.size ? setTimeout(flush, 300) : null
        }, 200)
    })
}

/** Library covers of the list, topped up from ComicVine once the card is on screen. */
export function useListCovers(list: { id: string, covers: string[] }) {
    const ref = useRef<HTMLAnchorElement>(null)
    const [covers, setCovers] = useState(list.covers)
    useEffect(() => {
        if (list.covers.length >= 3 || !ref.current) return
        const io = new IntersectionObserver(([e]) => {
            if (!e.isIntersecting) return
            io.disconnect()
            requestCovers(list.id).then(c => c.length > list.covers.length && setCovers(c))
        }, { rootMargin: "400px" })
        io.observe(ref.current)
        return () => io.disconnect()
    }, [list.id, list.covers])
    return { ref, covers }
}

/** Reading time like Batcave's "about 58 h": roughly 12 minutes per issue. */
export const readingTime = (issues: number) => {
    const minutes = issues * 12
    return minutes < 90 ? `about ${Math.max(1, Math.round(minutes / 10) * 10)} min` : `about ${Math.round(minutes / 60)} h`
}

/** Three covers fanned out: the first in front, the other two tilted behind it. */
export function FannedCovers({ covers, className = "" }: { covers: string[], className?: string }) {
    const [front, left, right] = covers
    const card = "absolute top-0 h-full aspect-[2/3] rounded-md overflow-hidden shadow-xl border border-black/30 bg-muted"
    return (
        <div className={`relative w-full ${className || "h-48 sm:h-56"}`}>
            {right && <img src={right} alt="" className={`${card} left-1/2 translate-x-[-10%] rotate-[8deg] opacity-80`} />}
            {left && <img src={left} alt="" className={`${card} left-1/2 translate-x-[-90%] -rotate-[8deg] opacity-80`} />}
            {front ? (
                <img src={front} alt="" className={`${card} left-1/2 -translate-x-1/2 z-10 transition-transform duration-300 group-hover:-translate-y-2`} />
            ) : (
                <div className={`${card} left-1/2 -translate-x-1/2 z-10 flex items-center justify-center`}><ListOrdered className="w-10 h-10 text-muted-foreground/40" /></div>
            )}
        </div>
    )
}

/** Owned / read badge: green when everything is owned. */
export function OwnedBadge({ list }: { list: ListSummary }) {
    const all = list.itemCount > 0 && list.ownedCount >= list.itemCount
    return (
        <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md ${all ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-foreground'}`}>
            {all ? 'All issues owned' : `${list.ownedCount} of ${list.itemCount} owned`}
        </span>
    )
}

export function ListCard({ list }: { list: ListSummary }) {
    const readPct = list.itemCount ? Math.round(100 * list.readCount / list.itemCount) : 0
    const { ref, covers } = useListCovers(list)
    return (
        <Link ref={ref} href={`/reading-lists?id=${list.id}`} className="group flex flex-col items-center text-center gap-1.5 p-3 rounded-xl hover:bg-muted/40 transition-colors">
            <FannedCovers covers={covers} className="h-48 sm:h-56 mb-3" />
            <h3 className="font-bold text-base leading-tight line-clamp-2">{displayName(list.name)}</h3>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{list.publisher} · {list.era}</p>
            <p className="text-xs text-muted-foreground">{list.itemCount} issues · {readingTime(list.itemCount)}</p>
            <OwnedBadge list={list} />
            {list.readCount > 0 && (
                <div className="flex items-center gap-2 w-32 mt-1" title={`${list.readCount} read`}>
                    <BookOpen className="w-3 h-3 text-primary shrink-0" />
                    <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${readPct}%` }} /></div>
                </div>
            )}
        </Link>
    )
}

/** Toggle chip with a count, like Batcave's filter bar. */
export function Chip({ active, onClick, label, count }: { active: boolean, onClick: () => void, label: string, count?: number }) {
    return (
        <button onClick={onClick}
            className={`h-9 px-4 rounded-full border text-sm font-bold transition-colors ${active ? 'border-primary text-primary bg-primary/10' : 'border-border text-foreground hover:bg-muted'}`}>
            {label}{count !== undefined && <span className="ml-2 text-xs opacity-60">{count}</span>}
        </button>
    )
}
