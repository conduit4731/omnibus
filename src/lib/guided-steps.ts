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

/** The guided view's steps after the whole page. */
export function guidedSteps(panels: Rect[], bubbles: Rect[], rtl = false): Rect[] {
    if (!panels.length) return bubbles.length >= 2 ? orderRects(bubbles, rtl).map(aroundBubble) : []
    return panels.flatMap(p => {
        const mine = area(p) >= BIG_PANEL ? bubbles.filter(b => inside(b, p)) : []
        return mine.length >= 2 ? [p, ...orderRects(mine, rtl).map(aroundBubble)] : [p]
    })
}
