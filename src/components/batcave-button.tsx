// Fork only: the two source buttons that sit next to every Request button (Request itself searches the indexers):
//   GetComicsButton (blue)  — the same request, GetComics only (directSource 'getcomics'); the caller does the request
//   BatcaveButton (orange)  — puts the issues on the Batcave queue (src/lib/batcave-queue.ts), which the userscript in an
//                             open Batcave tab downloads. Admins only: it uploads with an admin API key into the library.
"use client"

import { useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Check, CloudDownload, Globe, Loader2, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { QueueBody } from "@/lib/batcave-queue"

// One size for all three, wherever they sit: 32×32, same corners, no padding
const ICON_BTN = "h-8 w-8 min-h-8 min-w-8 p-0 rounded-md shrink-0 text-white border-0 shadow-sm"

// The normal request (indexers) as the first of the three icons; done = already requested.
// label: accessible name (e.g. "Request Batman #12"); srText: text only screen readers see (e.g. "Request all shown (3)").
export function RequestIconButton({ onClick, disabled, busy, done, className, title = "Request (Usenet)", label, srText }: {
    onClick: () => unknown
    disabled?: boolean
    busy?: boolean
    done?: boolean
    className?: string
    title?: string
    label?: string
    srText?: string
}) {
    return (
        <Button type="button" size="icon" title={done ? "Angefragt" : title} aria-label={label || (done ? "Angefragt" : title)} disabled={disabled || busy || done}
            className={cn(ICON_BTN, done ? "bg-emerald-600 disabled:opacity-100" : "bg-primary hover:bg-primary/90 text-primary-foreground", className)}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <Check className="w-4 h-4" /> : <CloudDownload className="w-4 h-4" />}
            <span className="sr-only">{done ? "Requested" : srText}</span>
        </Button>
    )
}

export function GetComicsButton({ onClick, disabled, className, title = "Über GetComics laden" }: {
    onClick: () => unknown
    disabled?: boolean
    className?: string
    title?: string
}) {
    const [busy, setBusy] = useState(false)
    return (
        <Button type="button" size="icon" title={title} aria-label={title} disabled={disabled || busy}
            className={cn(ICON_BTN, "bg-blue-600 hover:bg-blue-700", className)}
            onClick={async e => { e.preventDefault(); e.stopPropagation(); setBusy(true); try { await onClick() } finally { setBusy(false) } }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
        </Button>
    )
}

export function BatcaveButton({ body, className, title = "Über Batcave laden" }: {
    body: QueueBody | (() => QueueBody)
    className?: string
    title?: string
}) {
    const { data: session } = useSession()
    const { toast } = useToast()
    const [busy, setBusy] = useState(false)
    if (session?.user?.role !== 'ADMIN') return null

    const queue = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setBusy(true)
        const res = await fetch('/api/batcave/queue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(typeof body === 'function' ? body() : body),
        }).catch(() => null)
        const data = res ? await res.json().catch(() => ({})) : {}
        setBusy(false)
        const open = <ToastAction altText="Warteschlange" asChild><Link href="/batcave">Ansehen</Link></ToastAction>
        if (!res?.ok) toast({ title: "Batcave", description: data.error || "Fehler beim Einreihen", variant: "destructive" })
        else if (data.background) toast({ title: "Batcave", description: "Wird vorbereitet (Serien werden angelegt) und dann eingereiht.", action: open })
        else toast({ title: "Batcave", description: data.queued ? `${data.queued} Heft(e) eingereiht. Ein offener Batcave-Tab lädt sie.` : "Nichts zu laden: alles schon vorhanden.", action: open })
    }

    return (
        <Button type="button" size="icon" title={title} aria-label={title} disabled={busy} onClick={queue}
            className={cn(ICON_BTN, "bg-orange-500 hover:bg-orange-600", className)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Moon className="w-4 h-4" />}
        </Button>
    )
}

// The bulk variant: "All" and the three icons, tight and right-aligned
export function AllSources({ children, className, label = "All" }: { children: React.ReactNode, className?: string, label?: string | null }) {
    return (
        <div className={cn("flex items-center justify-end gap-1", className)}>
            {label && <span className="text-xs font-black uppercase tracking-wider text-muted-foreground mr-1">{label}</span>}
            {children}
        </div>
    )
}
