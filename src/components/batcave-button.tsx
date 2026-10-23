// Fork only: puts issues on the Batcave queue (src/lib/batcave-queue.ts). Sits next to the request buttons; admins only,
// because the userscript worker uploads with an admin API key into the shared library.
"use client"

import { useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Loader2, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { QueueBody } from "@/lib/batcave-queue"

export function BatcaveButton({ body, label = "Batcave", className, size = "sm", iconOnly = false }: {
    body: QueueBody | (() => QueueBody)
    label?: string
    className?: string
    size?: "sm" | "default" | "icon"
    iconOnly?: boolean
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
        <Button type="button" variant="outline" size={iconOnly ? "icon" : size} title="Über Batcave laden (Userscript im Batcave-Tab)"
            className={cn("font-bold border-indigo-400/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/10", className)}
            disabled={busy} onClick={queue}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Moon className="w-4 h-4" />}
            {!iconOnly && <span className="ml-1.5">{label}</span>}
        </Button>
    )
}
