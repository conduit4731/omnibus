"use client"

// Fork only: reading time per day, per series and per reading order (profile page).
import { deDayMonth } from "@/lib/date-de"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { Timer } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Row = { id: string, name: string, seconds: number, issues: number, year?: number | null, path?: string | null }
type Data = { totalSeconds: number, daily: { date: string, seconds: number }[], series: Row[], lists: Row[] }

const RANGES = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 365, label: "Year" }, { days: 0, label: "All" }]

export function formatDuration(seconds: number) {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`
}

// Bars per day for short ranges, per month for a year or everything; missing days show as 0
export function chartBuckets(daily: Data["daily"], days: number, today = new Date()) {
  const byDay = new Map(daily.map(d => [d.date, d.seconds]))
  if (days > 0 && days <= 31) {
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - (days - 1 - i))
      const key = d.toISOString().slice(0, 10)
      return { label: deDayMonth(key), minutes: Math.round((byDay.get(key) || 0) / 60) }
    })
  }
  const months = new Map<string, number>()
  for (const d of daily) months.set(d.date.slice(0, 7), (months.get(d.date.slice(0, 7)) || 0) + d.seconds)
  return [...months.entries()].sort().map(([k, s]) => ({ label: k, minutes: Math.round(s / 60) }))
}

function RankedBars({ rows, href }: { rows: Row[], href: (r: Row) => string | null }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground py-4">Nothing read in this period yet.</p>
  const max = rows[0].seconds || 1
  return (
    <div className="space-y-2">
      {rows.map(r => {
        const to = href(r)
        const name = <span className="truncate font-bold text-sm">{r.name}{r.year ? ` (${r.year})` : ""}</span>
        return (
          <div key={r.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              {to ? <Link href={to} className="truncate hover:text-primary">{name}</Link> : name}
              <span className="text-xs text-muted-foreground shrink-0">{formatDuration(r.seconds)} · {r.issues} {r.issues === 1 ? "issue" : "issues"}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (r.seconds / max) * 100)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ReadingTimeCard() {
  const [days, setDays] = useState(30)
  const [view, setView] = useState<"series" | "lists">("series")
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    fetch(`/api/user/reading-time?days=${days}`).then(r => r.ok ? r.json() : null).then(setData).catch(() => setData(null))
  }, [days])

  const chart = useMemo(() => data ? chartBuckets(data.daily, days) : [], [data, days])

  return (
    <Card className="shadow-sm bg-background border-border">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg"><Timer className="w-5 h-5 text-primary" /> Reading Time
            <span className="text-primary font-black">{formatDuration(data?.totalSeconds || 0)}</span>
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {RANGES.map(r => (
              <button key={r.days} onClick={() => setDays(r.days)}
                className={cn("text-xs font-bold px-2.5 py-1 rounded-full border", days === r.days ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary")}>{r.label}</button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: -20, right: 4 }}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: 'var(--muted-foreground)' }} interval="preserveStartEnd" />
              <YAxis axisLine={false} tickLine={false} fontSize={10} tick={{ fill: 'var(--muted-foreground)' }} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.4 }} formatter={(v) => [formatDuration(Number(v) * 60), "Read"]}
                contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
              <Bar dataKey="minutes" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-1">
          {(["series", "lists"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn("text-xs font-bold px-3 py-1 rounded-full border", view === v ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground")}>
              {v === "series" ? "By series" : "By reading order"}</button>
          ))}
        </div>
        {view === "series"
          ? <RankedBars rows={data?.series || []} href={r => r.path ? `/library/series?path=${encodeURIComponent(r.path)}` : null} />
          : <RankedBars rows={data?.lists || []} href={r => `/reading-lists?id=${r.id}`} />}
      </CardContent>
    </Card>
  )
}
