// Fork only: guided view for the reader ("Panel-Ansicht") — like ComiXology's Guided View or Marvel's Smart Panels,
// but with the panels found automatically (src/lib/panel-detect.ts) instead of authored by hand. Each page starts as
// the whole page, then zooms panel by panel; past the last panel comes the next page, back from the first the previous
// page's last panel. Detection runs once per page on a downscaled canvas in the browser and is cached for the session.
// Pages without panels (splashes, curved frames) and big panels step through their speech bubbles (a model in a web
// worker, src/workers/bubble-worker.ts), see src/lib/guided-steps.ts.
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { detectPanels, type Rect } from "@/lib/panel-detect"
import { guidedSteps } from "@/lib/guided-steps"
import { detectBubblesInBrowser } from "@/lib/bubble-detect-client"

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
const DETECT_WIDTH = 1600      // detectPanels works on half of it, and on all of it for hairline gutters
const cache = new Map<string, Rect[]>()
const bubbleCache = new Map<string, Promise<Rect[]>>()
const bubblesOf = (img: HTMLImageElement, src: string) => {
    if (!bubbleCache.has(src)) bubbleCache.set(src, detectBubblesInBrowser(img))
    return bubbleCache.get(src)!
}

// The model needs ~2 s per page in the browser (WebAssembly, one thread): work out the next page while this one is
// read, so its bubbles are ready when the reader gets there. Only pages that will use them (no panels, or a big one).
async function prefetch(src: string, rtl: boolean) {
    if (bubbleCache.has(src)) return
    const img = new Image()
    img.src = src
    try { await img.decode() } catch { return }
    const panels = await panelsOf(img, src, rtl)
    if (!panels.length || panels.some(p => p.w * p.h >= 0.3)) await bubblesOf(img, src)
}

async function panelsOf(img: HTMLImageElement, src: string, rtl: boolean): Promise<Rect[]> {
    const key = `${rtl ? 'rtl' : 'ltr'}:${src}`
    if (cache.has(key)) return cache.get(key)!
    const scale = Math.min(1, DETECT_WIDTH / img.naturalWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let panels: Rect[] = []
    try { panels = detectPanels(ctx.getImageData(0, 0, canvas.width, canvas.height), { rtl }) } catch { /* tainted canvas: whole page */ }
    cache.set(key, panels)
    return panels
}

export function GuidedView({ src, nextSrc, rtl, enterAtEnd, onNextPage, onPrevPage, onToggleUI, imgStyle }: {
    src: string
    nextSrc?: string               // the page after this one: its detection runs in the background
    rtl: boolean
    enterAtEnd: boolean            // came back from the next page: start on the last panel
    onNextPage: () => void
    onPrevPage: () => void
    onToggleUI: () => void
    imgStyle?: React.CSSProperties // brightness / contrast from the reader settings
}) {
    const boxRef = useRef<HTMLDivElement>(null)
    const imgRef = useRef<HTMLImageElement>(null)
    const [steps, setSteps] = useState<Rect[]>([FULL])
    const [step, setStep] = useState(0)
    const [natural, setNatural] = useState<{ w: number, h: number } | null>(null)
    const [box, setBox] = useState({ w: 0, h: 0 })

    useEffect(() => {
        const el = boxRef.current
        if (!el) return
        const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    const onLoad = async () => {
        const img = imgRef.current
        if (!img) return
        setNatural({ w: img.naturalWidth, h: img.naturalHeight })
        const panels = await panelsOf(img, src, rtl)
        const base = [FULL, ...panels]
        setSteps(base)
        setStep(enterAtEnd ? base.length - 1 : 0)
        // Speech bubbles (model in a worker, a few hundred ms): the steps of a page without panels, and of big panels.
        // Arriving later, they must not move the reader: the panel being shown stays the current step.
        const needsBubbles = !panels.length || panels.some(p => p.w * p.h >= 0.3)
        if (nextSrc) prefetch(nextSrc, rtl)  // queued behind this page in the worker
        if (!needsBubbles) return
        setDetecting(true)
        const bubbles = await bubblesOf(img, src)
        if (!mounted.current) return
        setDetecting(false)
        const all = bubbles.length ? [FULL, ...guidedSteps(panels, bubbles, rtl)] : base
        const waited = waitingNext.current
        waitingNext.current = false
        setWaiting(false)
        if (all.length !== base.length) setSteps(all)
        const s = stepRef.current
        const at = s === base.length - 1 && enterAtEnd && !waited ? all.length - 1 : Math.max(0, all.indexOf(base[s]))
        // "Next" was pressed while the bubbles were still being found: take that step now
        if (waited && at + 1 >= all.length) { setStep(at); onNextPage() }
        else setStep(waited ? at + 1 : at)
    }
    // While the model works on this page, "next" on its last known step waits instead of leaving the page
    const [detecting, setDetecting] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const waitingNext = useRef(false)
    const stepRef = useRef(0)
    useEffect(() => { stepRef.current = step }, [step])
    const mounted = useRef(true)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

    // The reader mounts one GuidedView per page (key = page). A page the browser already had (preloaded, or the one we
    // came back to) can finish loading before React attaches onLoad — then it never fires, and the page stayed hidden.
    useEffect(() => {
        const img = imgRef.current
        if (img?.complete && img.naturalWidth) onLoad()
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted page
    }, [])

    const next = useCallback(() => {
        if (step < steps.length - 1) setStep(step + 1)
        else if (detecting) { waitingNext.current = true; setWaiting(true) }
        else onNextPage()
    }, [step, steps.length, onNextPage, detecting])
    const prev = useCallback(() => { if (step > 0) setStep(step - 1); else onPrevPage() }, [step, onPrevPage])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const forward = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft'
            if (e.key === forward || e.key === ' ') { e.preventDefault(); next() }
            else if (e.key === back) { e.preventDefault(); prev() }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [next, prev, rtl])

    const touch = useRef<{ x: number, y: number } | null>(null)

    // Fit the current step into the viewport with a small margin, centred
    let transform = 'none'
    if (natural && box.w && box.h) {
        const r = steps[Math.min(step, steps.length - 1)]
        const pw = r.w * natural.w, ph = r.h * natural.h
        const s = Math.min(box.w * 0.96 / pw, box.h * 0.96 / ph)
        const tx = box.w / 2 - (r.x * natural.w + pw / 2) * s
        const ty = box.h / 2 - (r.y * natural.h + ph / 2) * s
        transform = `translate(${tx}px, ${ty}px) scale(${s})`
    }

    return (
        <div ref={boxRef} className="relative w-full h-full overflow-hidden z-10"
            onTouchStart={e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
            onTouchEnd={e => {
                const t = touch.current; touch.current = null
                if (!t) return
                const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if ((dx < 0) !== rtl) next(); else prev() }
            }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- page images come from the reader API, not next/image */}
            <img ref={imgRef} src={src} alt="" draggable={false} onLoad={onLoad}
                className="absolute top-0 left-0 max-w-none origin-top-left transition-transform duration-300 ease-out motion-reduce:transition-none"
                style={{ ...imgStyle, transform, visibility: natural ? 'visible' : 'hidden' }} />
            {/* tap zones: back / menu / forward */}
            <button type="button" aria-label="Zurück" className="absolute inset-y-0 left-0 w-[30%] z-20 bg-transparent" onClick={rtl ? next : prev} />
            <button type="button" aria-label="Menü" className="absolute inset-y-0 left-[30%] w-[40%] z-20 bg-transparent" onClick={onToggleUI} />
            <button type="button" aria-label="Weiter" className="absolute inset-y-0 right-0 w-[30%] z-20 bg-transparent" onClick={rtl ? prev : next} />
            {waiting && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 text-[11px] font-bold text-white/80 bg-black/60 rounded px-2 py-0.5 pointer-events-none">
                    Sprechblasen werden erkannt…
                </div>
            )}
            {steps.length > 1 && (
                <div className="absolute bottom-3 right-3 z-30 text-[11px] font-bold text-white/70 bg-black/50 rounded px-1.5 py-0.5 pointer-events-none">
                    {step === 0 ? 'Seite' : `Panel ${step}/${steps.length - 1}`}
                </div>
            )}
        </div>
    )
}
