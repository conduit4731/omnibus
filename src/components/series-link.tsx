// Fork: series names open the series page wherever they appear (reading lists, requests, home, calendar).
import Link from "next/link"
import type { ReactNode } from "react"

export const seriesHref = (folderPath: string) => `/library/series?path=${encodeURIComponent(folderPath)}`

/** The series name as a link when the series is in the library; plain text otherwise. */
export function SeriesLink({ series, folderPath, className = "", children }: {
    series?: { folderPath?: string | null } | null, folderPath?: string | null, className?: string, children: ReactNode
}) {
    const path = folderPath || series?.folderPath
    if (!path) return <span className={className}>{children}</span>
    return <Link href={seriesHref(path)} onClick={e => e.stopPropagation()} className={`${className} hover:text-primary hover:underline`}>{children}</Link>
}
