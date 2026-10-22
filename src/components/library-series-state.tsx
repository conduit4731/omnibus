"use client"

// Fork only: series state in the library — "49/52", Complete, Ongoing / Ended — as cover badges (grid) and as
// one table column each (list). Kept out of src/app/library/page.tsx to keep the upstream merge small.
import { Activity, Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { isEndedStatus } from "@/lib/library-insights"

type SeriesState = { count: number, released?: number, complete?: boolean, status?: string | null, metadataId?: string | null, monitored?: boolean }

/** "49/52" when released issues are missing, else the count. */
export const issuesLabel = (item: SeriesState) => item.released && item.released > item.count ? `${item.count}/${item.released}` : `${item.count}`

export function SeriesStateBadges({ item }: { item: SeriesState }) {
  const ended = isEndedStatus(item.status)
  return (
    <>
      {item.complete && <Badge className="text-[9px] px-1.5 h-4 bg-violet-600 hover:bg-violet-600 border-0 text-white font-black uppercase tracking-wider shadow-sm" title="Every released issue is in your library">Complete</Badge>}
      {item.status && <Badge className={cn("text-[9px] px-1.5 h-4 border-0 font-bold uppercase tracking-wider shadow-sm", ended ? "bg-zinc-600 hover:bg-zinc-600 text-white" : "bg-sky-600 hover:bg-sky-600 text-white")}>{ended ? 'Ended' : 'Ongoing'}</Badge>}
    </>
  )
}

const none = <span className="text-muted-foreground">–</span>

/** Read, Collection, Status and Monitored cells of a library table row. */
export function SeriesStateCells({ item, unread, isCompleted }: { item: SeriesState, unread: number, isCompleted: boolean }) {
  const missing = (item.released || 0) - item.count
  return (
    <>
      <td className="px-3 py-3 text-center">
        {isCompleted ? <Badge className="bg-green-600 hover:bg-green-600 text-white border-0 text-[10px] font-bold uppercase tracking-wider"><Check className="w-3 h-3 mr-1" />Read</Badge>
          : unread > 0 ? <Badge className="bg-primary/20 text-primary border-0 font-bold uppercase tracking-wider text-[10px]">{unread === item.count ? 'Unread' : `${unread} Left`}</Badge>
          : none}
      </td>
      <td className="px-3 py-3 text-center hidden md:table-cell">
        {item.complete ? <Badge className="bg-violet-600 hover:bg-violet-600 text-white border-0 text-[10px] font-bold uppercase tracking-wider">Complete</Badge>
          : /^\d+$/.test(item.metadataId || '') && missing > 0 ? <span className="text-xs font-bold text-orange-600 dark:text-orange-400">{missing} missing</span>
          : none}
      </td>
      <td className="px-3 py-3 text-center hidden md:table-cell">
        {item.status ? <Badge className={cn("border-0 text-[10px] font-bold uppercase tracking-wider text-white", isEndedStatus(item.status) ? "bg-zinc-600 hover:bg-zinc-600" : "bg-sky-600 hover:bg-sky-600")}>{isEndedStatus(item.status) ? 'Ended' : 'Ongoing'}</Badge> : none}
      </td>
      <td className="px-3 py-3 text-center hidden lg:table-cell">
        {item.monitored ? <Activity className="w-4 h-4 text-emerald-600 mx-auto" aria-label="Monitored" /> : none}
      </td>
    </>
  )
}
