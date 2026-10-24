// src/lib/guided-steps.ts
//
// Fork only: the zoom steps of the reader's guided view (src/components/guided-view.tsx) from a page's panels
// (src/lib/panel-detect.ts) and its speech bubbles (src/workers/bubble-worker.ts, a YOLO model in the browser):
//   - a page with panels: panel by panel; a big panel (a third of the page or more) holding two or more bubbles
//     is followed by its bubbles one by one
//   - a page without panels (splash, curved frames): bubble by bubble
// Bubbles are read like panels (rows top to bottom, left to right / right to left for manga) and shown with some of
// the art around them, so a step is a scene, not just the text.
import { orderRects, type Rect } from '@/lib/panel-detect'

// The settings readers know from Guided View / Panel View apps (Kindle, ComiXology, YACReader, bloopworm)
export type GuidedSettings = {
    fullPage: 'start' | 'end' | 'both' | 'never'   // where the whole page is a step of its own
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

/** The guided view's steps after the whole page. */
export function guidedSteps(panels: Rect[], bubbles: Rect[], rtl = false): Rect[] {
    if (!panels.length) return bubbles.length >= 2 ? bubbleSteps(bubbles, rtl) : []
    return panels.flatMap(p => {
        const mine = area(p) >= BIG_PANEL ? bubbles.filter(b => inside(b, p)) : []
        return mine.length >= 2 ? [p, ...bubbleSteps(mine, rtl)] : [p]
    })
}

/** Whether a page needs the bubble model at all for these settings. */
export function needsBubbles(panels: Rect[], mode: GuidedSettings['mode']): boolean {
    return mode === 'bubbles' || (mode === 'auto' && (!panels.length || panels.some(p => area(p) >= BIG_PANEL)))
}

/** All steps of a page for the settings, the whole page included where it belongs. */
export function buildSteps(panels: Rect[], bubbles: Rect[], s: Pick<GuidedSettings, 'fullPage' | 'mode'>, rtl = false): Rect[] {
    const inner = s.mode === 'panels' ? panels
        : s.mode === 'bubbles' ? (bubbles.length ? bubbleSteps(bubbles, rtl) : panels)
        : guidedSteps(panels, bubbles, rtl)
    if (!inner.length) return [FULL]
    return [...(s.fullPage === 'start' || s.fullPage === 'both' ? [FULL] : []), ...inner, ...(s.fullPage === 'end' || s.fullPage === 'both' ? [FULL] : [])]
}
