// src/lib/guided-steps.ts
//
// Fork only: the zoom steps of the reader's guided view (src/components/guided-view.tsx) from a page's panels
// (src/lib/panel-detect.ts) and its speech bubbles (src/workers/bubble-worker.ts, a YOLO model in the browser):
//   - a page with panels: panel by panel; a big panel (a third of the page or more) holding two or more bubbles
//     is followed by its parts
//   - a page without panels (splash, curved frames): its parts — rows cut between the balloons (a wide row split
//     in two columns), so no balloon is cut and no art is left out (Marvel's Smart Panels on such pages)
//   - every step grows to take in the balloons reaching into it, so none is cut at a panel edge
// "Nur Sprechblasen" steps through the balloons themselves, each with some of the art around it.
import { orderRects, type Rect } from '@/lib/panel-detect'

// The settings readers know from Guided View / Panel View apps (Kindle, ComiXology, YACReader, bloopworm)
export type GuidedSettings = {
    fullPage: 'start' | 'peek' | 'end' | 'both' | 'never'  // where the whole page is a step; peek: briefly, then zoom in by itself (Marvel / DC)
    mode: 'auto' | 'panels' | 'bubbles'            // auto: panels, bubbles where there are none / in big panels
    outside: 'show' | 'dim' | 'black'              // the art around the current frame
    transition: 'smooth' | 'fast' | 'off'
    margin: 'tight' | 'normal' | 'wide'            // room around the frame when zoomed in
}
export const DEFAULT_GUIDED: GuidedSettings = { fullPage: 'start', mode: 'auto', outside: 'show', transition: 'smooth', margin: 'normal' }
export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }

const BIG_PANEL = 0.3
const area = (r: Rect) => r.w * r.h
const inside = (b: Rect, p: Rect) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    return cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h
}

/** A bubble with the art around it: at least 2.2× its size and 40 % of the page wide, kept on the page. */
export function aroundBubble(b: Rect): Rect {
    const w = Math.min(1, Math.max(b.w * 2.2, 0.4)), h = Math.min(1, Math.max(b.h * 2.2, 0.22))
    const x = Math.min(Math.max(b.x + b.w / 2 - w / 2, 0), 1 - w), y = Math.min(Math.max(b.y + b.h / 2 - h / 2, 0), 1 - h)
    return { x, y, w, h }
}

const union = (a: Rect, b: Rect): Rect => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Balloons in reading order, each with its surroundings — but a balloon that the previous step's frame would cut
 * (they sit close together) joins that step instead, so it is shown whole once rather than cut once and never again.
 */
export function bubbleSteps(bubbles: Rect[], rtl: boolean): Rect[] {
    const groups: Rect[] = []
    for (const b of orderRects(bubbles, rtl)) {
        const last = groups[groups.length - 1]
        const joined = last && union(last, b)
        if (last && touches(aroundBubble(last), b) && joined.w <= 0.6 && joined.h <= 0.45) groups[groups.length - 1] = joined
        else groups.push(b)
    }
    return groups.map(aroundBubble)
}

const MIN_ROW = 0.18, MAX_ROW = 0.42  // of the page's height
// Where a line at v may cut: not through a balloon; the further from the nearest balloon edge the better
const clearance = (v: number, bs: Rect[], axis: 'x' | 'y') => {
    let d = 0.04
    for (const b of bs) {
        const a = axis === 'y' ? b.y : b.x, z = axis === 'y' ? b.y + b.h : b.x + b.w
        if (v > a && v < z) return -1
        d = Math.min(d, Math.abs(v - a), Math.abs(v - z))
    }
    return d
}
function bestCut(from: number, to: number, ideal: number, bs: Rect[], axis: 'x' | 'y'): number | null {
    let best: number | null = null, score = -1
    for (let v = from; v <= to; v += 0.005) {
        const c = clearance(v, bs, axis)
        const sc = c < 0 ? -1 : c - Math.abs(v - ideal) * 0.05
        if (sc > score) { score = sc; best = v }
    }
    return best
}

/** An area in reading-sized parts: rows cut between the balloons, a wide row in two columns. Covers all of it. */
export function regions(a: Rect, bubbles: Rect[], rtl = false): Rect[] {
    const bs = bubbles.filter(b => inside(b, a)), bottom = a.y + a.h, rows: Rect[] = []
    let top = a.y
    while (bottom - top > MAX_ROW) {
        let cut = bestCut(top + MIN_ROW, top + MAX_ROW, top + (MIN_ROW + MAX_ROW) / 2, bs, 'y')
        // no gap in reach: the row ends below the balloon in the way
        if (cut === null) cut = Math.max(...bs.filter(b => b.y < top + MAX_ROW && b.y + b.h > top + MAX_ROW).map(b => b.y + b.h))
        if (cut >= bottom - MIN_ROW * 0.6) break
        rows.push({ x: a.x, y: top, w: a.w, h: cut - top })
        top = cut
    }
    rows.push({ x: a.x, y: top, w: a.w, h: bottom - top })
    return rows.flatMap(row => {
        const mine = bs.filter(b => inside(b, row))
        if (row.w < 0.6 || mine.length < 2) return [row]
        const cut = bestCut(row.x + row.w * 0.3, row.x + row.w * 0.7, row.x + row.w / 2, mine, 'x')
        if (cut === null || !mine.some(b => b.x + b.w <= cut) || !mine.some(b => b.x >= cut)) return [row]
        const left = { ...row, w: cut - row.x }, right = { ...row, x: cut, w: row.x + row.w - cut }
        return rtl ? [right, left] : [left, right]
    })
}

/** A step grown to take in every balloon that reaches into it (a quarter of it or more), kept on the page. */
function withBalloons(r: Rect, bubbles: Rect[]): Rect {
    let out = r
    for (const b of bubbles) {
        const ix = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x), iy = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y)
        if (ix > 0 && iy > 0 && ix * iy >= area(b) * 0.25) out = union(out, b)
    }
    return out
}

/** The guided view's steps after the whole page. */
export function guidedSteps(panels: Rect[], bubbles: Rect[], rtl = false): Rect[] {
    if (!panels.length) return bubbles.length ? regions(FULL, bubbles, rtl) : []
    return panels.flatMap(p => {
        const parts = area(p) >= BIG_PANEL && bubbles.filter(b => inside(b, p)).length >= 2 ? regions(p, bubbles, rtl) : []
        return parts.length > 1 ? [p, ...parts] : [p]
    }).map(r => withBalloons(r, bubbles))
}

/** Whether a page needs the bubble model at all for these settings. */
export function needsBubbles(mode: GuidedSettings['mode']): boolean {
    return mode !== 'panels'
}

/** The step in steps that shows most of r (to stay put when a page's steps are refined). */
export function closestStep(steps: Rect[], r: Rect): number {
    let best = 0, score = -1
    steps.forEach((s, i) => {
        const ix = Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x), iy = Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y)
        const iou = ix > 0 && iy > 0 ? ix * iy / (area(r) + area(s) - ix * iy) : 0
        if (iou > score) { score = iou; best = i }
    })
    return best
}

/** All steps of a page for the settings, the whole page included where it belongs. */
export function buildSteps(panels: Rect[], bubbles: Rect[], s: Pick<GuidedSettings, 'fullPage' | 'mode'>, rtl = false): Rect[] {
    const inner = s.mode === 'panels' ? panels
        : s.mode === 'bubbles' ? (bubbles.length ? bubbleSteps(bubbles, rtl) : panels)
        : guidedSteps(panels, bubbles, rtl)
    if (!inner.length) return [FULL]
    return [...(s.fullPage === 'start' || s.fullPage === 'peek' || s.fullPage === 'both' ? [FULL] : []), ...inner, ...(s.fullPage === 'end' || s.fullPage === 'both' ? [FULL] : [])]
}
