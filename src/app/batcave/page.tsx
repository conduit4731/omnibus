// Fork only: state of the Batcave queue (src/lib/batcave-queue.ts) — what is waiting, what Batcave did not have,
// and whether the userscript worker in a Batcave tab is polling.
"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Moon, RotateCcw, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { seriesHref } from "@/components/series-link"

type Job = { id: string; seriesId: string; series: string; seriesPath: string | null; number: string; isAnnual: boolean; status: string; message: string | null; updatedAt: string }
type Status = { counts: Record<string, number>; jobs: Job[]; recent: Job[]; workerSeen: number | null }

const LABEL: Record<string, string> = { QUEUED: "Wartet", NOT_FOUND: "Bei Batcave nicht gefunden", ERROR: "Fehler", DONE: "Geladen" }

function ago(ms: number) {
    const m = Math.round((Date.now() - ms) / 60000)
    return m < 1 ? "gerade eben" : m < 60 ? `vor ${m} Min.` : m < 1440 ? `vor ${Math.round(m / 60)} Std.` : `vor ${Math.round(m / 1440)} Tagen`
}

export default function BatcavePage() {
    const [data, setData] = useState<Status | null>(null)
    const [error, setError] = useState<string | null>(null)
    const load = useCallback(() => {
        fetch('/api/batcave/status').then(async r => r.ok ? setData(await r.json()) : setError((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`))
    }, [])
    useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])
    const act = async (action: string, ids?: string[]) => {
        await fetch('/api/batcave/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }) })
        load()
    }

    if (error) return <div className="container mx-auto py-10 px-6 text-destructive">{error}</div>
    if (!data) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>

    const workerFresh = data.workerSeen && Date.now() - data.workerSeen < 10 * 60000
    const groups = (status: string) => {
        const m = new Map<string, Job[]>()
        for (const j of data.jobs.filter(j => j.status === status)) m.set(j.series, [...(m.get(j.series) || []), j])
        return [...m]
    }
    const issueLabel = (j: Job) => j.isAnnual ? `Annual ${j.number}` : `#${j.number}`

    return (
        <div className="container mx-auto py-10 px-4 sm:px-6 max-w-[1100px] space-y-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-black flex items-center gap-3"><Moon className="w-7 h-7 text-indigo-500" /> Batcave-Warteschlange</h1>
                <p className="text-muted-foreground text-sm max-w-2xl">
                    Hefte, die über den Batcave-Button eingereiht wurden. Geladen werden sie von einem offenen Batcave-Tab mit dem
                    Userscript „Batcave → Omnibus“ (Hintergrund-Modus an), nacheinander und im Rahmen des Tageslimits.
                </p>
                <p className={workerFresh ? "text-sm text-green-600 dark:text-green-400" : "text-sm text-amber-600 dark:text-amber-400"}>
                    {data.workerSeen ? `Batcave-Tab hat zuletzt ${ago(data.workerSeen)} nach Arbeit gefragt.` : "Noch kein Batcave-Tab hat nach Arbeit gefragt."}
                    {!workerFresh && " Öffne batcave.biz und schalte im Skript-Fenster den Hintergrund-Modus ein."}
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                {["QUEUED", "NOT_FOUND", "ERROR", "DONE"].map(s => (
                    <Badge key={s} variant="outline" className="text-sm py-1 px-3">{LABEL[s]}: {data.counts[s] || 0}</Badge>
                ))}
                <div className="flex-1" />
                {(data.counts.NOT_FOUND || data.counts.ERROR) ? <Button size="sm" variant="outline" onClick={() => act('retry')}><RotateCcw className="w-4 h-4 mr-1.5" /> Fehlgeschlagene erneut</Button> : null}
                {data.counts.DONE ? <Button size="sm" variant="outline" onClick={() => act('clearDone')}><Trash2 className="w-4 h-4 mr-1.5" /> Geladene ausblenden</Button> : null}
            </div>

            {["QUEUED", "NOT_FOUND", "ERROR"].map(status => groups(status).length > 0 && (
                <section key={status} className="space-y-3">
                    <h2 className="text-lg font-bold">{LABEL[status]}</h2>
                    <div className="divide-y divide-border rounded-lg border border-border">
                        {groups(status).map(([series, jobs]) => (
                            <div key={series} className="p-3 flex flex-col sm:flex-row sm:items-start gap-2">
                                {jobs[0].seriesPath
                                    ? <Link href={seriesHref(jobs[0].seriesPath)} className="font-semibold sm:w-72 shrink-0 hover:text-primary">{series}</Link>
                                    : <span className="font-semibold sm:w-72 shrink-0">{series}</span>}
                                <div className="flex flex-wrap gap-1.5 flex-1">
                                    {jobs.map(j => (
                                        <span key={j.id} title={j.message || undefined} className="inline-flex items-center gap-1 text-xs rounded border border-border px-1.5 py-0.5">
                                            {issueLabel(j)}
                                            {j.message && status !== 'QUEUED' && <span className="text-muted-foreground">· {j.message}</span>}
                                            <button aria-label="Entfernen" className="text-muted-foreground hover:text-destructive" onClick={() => act('remove', [j.id])}><X className="w-3 h-3" /></button>
                                        </span>
                                    ))}
                                </div>
                                {status !== 'QUEUED' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => act('retry', jobs.map(j => j.id))}>Erneut</Button>}
                            </div>
                        ))}
                    </div>
                </section>
            ))}

            {data.recent.length > 0 && (
                <section className="space-y-3">
                    <h2 className="text-lg font-bold">Zuletzt geladen</h2>
                    <ul className="text-sm text-muted-foreground space-y-1">
                        {data.recent.map(j => <li key={j.id}>{j.series} {issueLabel(j)} · {ago(new Date(j.updatedAt).getTime())}{j.message ? ` · ${j.message}` : ''}</li>)}
                    </ul>
                </section>
            )}
        </div>
    )
}
