"use client"

// Fork only: collapsible "Insights" panel on the library page (data from /api/library/insights).
import { useEffect, useState } from "react"
import Link from "next/link"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, Legend } from "recharts"
import { BarChart3, ChevronDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Insights = {
  publishers: string[]
  kpis: { series: number, issues: number, read: number, complete: number, ongoing: number, missing: number, upcoming: number }
  byPublisher: { publisher: string, read: number, unread: number, missing: number }[]
  byYear: ({ year: number } & Record<string, number>)[]
  growth: { month: string, added: number, total: number }[]
  backlog: { id: string, name: string, year: number | null, path: string | null, unread: number, owned: number }[]
  upcoming: { week: string, issues: number }[]
}

const PUBLISHER_COLORS: Record<string, string> = { DC: "#3b82f6", Marvel: "#ef4444", Image: "#a3a3a3", "Dark Horse": "#f59e0b", IDW: "#10b981", Other: "#64748b" }
const FALLBACK = ["#8b5cf6", "#ec4899", "#14b8a6", "#eab308"]
const colorOf = (p: string, i: number) => PUBLISHER_COLORS[p] || FALLBACK[i % FALLBACK.length]
const tooltip = { contentStyle: { backgroundColor: 'var(--popover)', borderColor: 'var(--border)', color: 'var(--foreground)', fontSize: 12 }, cursor: { fill: 'var(--muted)', opacity: 0.4 } }
const axis = { axisLine: false, tickLine: false, fontSize: 10, tick: { fill: 'var(--muted-foreground)' } }
const STORAGE_KEY = "omnibus-library-insights-open"

function Kpi({ label, value, hint }: { label: string, value: string | number, hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 text-center" title={hint}>
      <div className="text-xl font-black text-foreground">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  )
}

function Panel({ title, children, className }: { title: string, children: React.ReactNode, className?: string }) {
  return (
    <Card className={cn("shadow-sm bg-background border-border", className)}>
      <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  )
}

export function LibraryInsights() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Insights | null>(null)

  useEffect(() => { try { setOpen(localStorage.getItem(STORAGE_KEY) === "1") } catch { /* private mode */ } }, [])
  useEffect(() => {
    if (!open || data) return
    fetch("/api/library/insights").then(r => r.ok ? r.json() : null).then(setData).catch(() => {})
  }, [open, data])
  const toggle = () => { setOpen(o => { try { localStorage.setItem(STORAGE_KEY, o ? "0" : "1") } catch { /* private mode */ } return !o }) }

  const k = data?.kpis
  return (
    <div className="mb-6">
      <button onClick={toggle} aria-expanded={open} className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground">
        <BarChart3 className="w-4 h-4 text-primary" /> Insights
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (!data ? <p className="text-sm text-muted-foreground mt-3">Loading…</p> : (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Kpi label="Series" value={k!.series} />
            <Kpi label="Issues" value={k!.issues} />
            <Kpi label="Read" value={k!.issues ? `${Math.round(k!.read / k!.issues * 100)}%` : "–"} hint={`${k!.read} of ${k!.issues} issues`} />
            <Kpi label="Complete series" value={k!.complete} hint="Every released issue in your library" />
            <Kpi label="Ongoing" value={k!.ongoing} />
            <Kpi label="Missing" value={k!.missing} hint="Released issues of your series that you don't have" />
            <Kpi label="Next 8 weeks" value={k!.upcoming} hint="Upcoming issues of your series" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Collection by publisher">
              <div style={{ height: Math.max(120, data.byPublisher.length * 34) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byPublisher} layout="vertical" margin={{ left: 0, right: 8 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="publisher" width={80} {...axis} fontSize={11} />
                    <Tooltip {...tooltip} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="read" name="Read" stackId="a" fill="#22c55e" />
                    <Bar dataKey="unread" name="Unread" stackId="a" fill="var(--primary)" />
                    <Bar dataKey="missing" name="Missing" stackId="a" fill="#f97316" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Issues by release year">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byYear} margin={{ left: -20, right: 4 }}>
                    <XAxis dataKey="year" {...axis} interval="preserveStartEnd" />
                    <YAxis {...axis} allowDecimals={false} />
                    <Tooltip {...tooltip} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.publishers.map((p, i) => <Bar key={p} dataKey={p} stackId="y" fill={colorOf(p, i)} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Library growth">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.growth} margin={{ left: -10, right: 4 }}>
                    <XAxis dataKey="month" {...axis} interval="preserveStartEnd" />
                    <YAxis {...axis} allowDecimals={false} />
                    <Tooltip {...tooltip} formatter={(v, n) => [v, n === "total" ? "In library" : "Added"]} />
                    <Area type="monotone" dataKey="total" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} />
                    <Area type="monotone" dataKey="added" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Reading pile — most unread issues">
              {data.backlog.length === 0 ? <p className="text-sm text-muted-foreground">Nothing unread. Impressive.</p> : (
                <div className="space-y-2">
                  {data.backlog.map(s => (
                    <div key={s.id} className="space-y-1">
                      <div className="flex justify-between gap-3 text-sm">
                        {s.path ? <Link href={`/library/series?path=${encodeURIComponent(s.path)}`} className="truncate font-bold hover:text-primary">{s.name}{s.year ? ` (${s.year})` : ""}</Link>
                                : <span className="truncate font-bold">{s.name}</span>}
                        <span className="text-xs text-muted-foreground shrink-0">{s.unread} of {s.owned} unread</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(s.unread / data.backlog[0].unread) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {data.upcoming.length > 0 && (
              <Panel title="Upcoming issues of your series (by week)" className="lg:col-span-2">
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.upcoming} margin={{ left: -20, right: 4 }}>
                      <XAxis dataKey="week" {...axis} />
                      <YAxis {...axis} allowDecimals={false} />
                      <Tooltip {...tooltip} formatter={(v) => [v, "Issues"]} labelFormatter={(w) => `Week of ${w}`} />
                      <Bar dataKey="issues" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
