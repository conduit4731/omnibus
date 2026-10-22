"use client"

// Fork only: the series page's era / event chips and columns, release dates and per-issue download buttons.
// Kept out of src/app/library/series/page.tsx so the weekly upstream merge touches as little fork code as possible.
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Fork: per missing issue — GetComics only (Omnibus' DDL path, no indexers) and a Batcave search to download
// by hand into ~/batcave (the Mac sync + omnibus-match.sh file it). Batcave runs DataLife Engine: search by GET.
// buttonClass: the same classes as the row's Request button, so all three match
export function DirectSources({ onGetComics, disabled, seriesName, buttonClass }: { onGetComics: () => void, disabled: boolean, seriesName: string, buttonClass: string }) {
  return (
    <>
      <Button size="sm" variant="outline" className={buttonClass} title="Request from GetComics only"
        disabled={disabled} onClick={e => { e.stopPropagation(); onGetComics() }}>GetComics</Button>
      <Button size="sm" variant="outline" className={buttonClass} title="Find this series on Batcave and download it into ~/batcave" asChild>
        <a href={`https://batcave.biz/index.php?do=search&subaction=search&story=${encodeURIComponent(seriesName)}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Batcave</a>
      </Button>
    </>
  )
}

// Fork: era / events of an issue as table cells; a click filters the issue lists to that chip
export const chipKey = (c: IssueChip) => `${c.kind}:${c.name}`
export function ChipCell({ chips, kind, active, onPick }: { chips?: IssueChip[], kind: IssueChip['kind'], active: string | null, onPick: (key: string | null) => void }) {
  const mine = (chips || []).filter(c => c.kind === kind)
  return (
    <td className="px-3 py-3 hidden md:table-cell">
      <div className="flex flex-wrap gap-1">
        {mine.map(c => (
          <button key={c.href} title={active === chipKey(c) ? "Show all issues" : `Only issues in ${c.name}`}
            onClick={e => { e.stopPropagation(); onPick(active === chipKey(c) ? null : chipKey(c)) }}
            className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded truncate max-w-[160px]",
              active === chipKey(c) ? "bg-primary text-primary-foreground" : kind === 'era' ? "bg-muted text-muted-foreground hover:text-foreground" : "bg-primary/10 text-primary hover:bg-primary/20")}>{c.name}</button>
        ))}
      </div>
    </td>
  )
}

// Fork: when a missing issue came out or comes out ("YYYY-MM-DD" from the metadata provider)
export function ReleaseInfo({ date }: { date?: string | null }) {
  const d = date ? new Date(`${date.slice(0, 10)}T12:00:00`) : null
  if (!d || isNaN(d.getTime())) return <div className="text-[10px] mt-1 text-muted-foreground">Release date unknown</div>
  const upcoming = date!.slice(0, 10) > new Date().toISOString().slice(0, 10)
  const text = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return <div className={cn("text-[10px] mt-1", upcoming ? "font-bold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{upcoming ? `Releases ${text}` : `Released ${text}`}</div>
}

// Fork: Batcave-style chips on an issue: its era ("New 52", to the events of that era) and its events (to the list)
export type SeriesListRef = { id: string, name: string, category?: string, issueCount?: number }
export type IssueChip = { name: string, href: string, kind: 'era' | 'event' }
export function ListChips({ lists }: { lists?: IssueChip[] }) {
  if (!lists?.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {lists.slice(0, 3).map(l => (
        <Link key={l.href} href={l.href} onClick={e => e.stopPropagation()} title={l.kind === 'era' ? `Era: ${l.name}` : `Event: ${l.name}`}
          className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded truncate max-w-[180px]",
            l.kind === 'era' ? "bg-muted text-muted-foreground hover:text-foreground" : "bg-primary/10 text-primary hover:bg-primary/20")}>
          {l.kind === 'event' && <span className="opacity-70">Event: </span>}{l.name}</Link>
      ))}
      {lists.length > 3 && <span className="text-[10px] font-bold text-muted-foreground px-1" title={lists.slice(3).map(l => l.name).join(', ')}>+{lists.length - 3}</span>}
    </div>
  )
}
