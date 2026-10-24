// Fork only: guided view for the reader ("Panel-Ansicht") — like ComiXology's Guided View or Marvel's Smart Panels,
// but with the panels found automatically (src/lib/panel-detect.ts) instead of authored by hand. Steps (whole page,
// panels, speech bubbles) come from src/lib/guided-steps.ts; past the last step comes the next page, back from the first
// the previous page's last step. Bubbles come from a model in a web worker (src/workers/bubble-worker.ts).
// Settings like the Guided View / Panel View apps have (whole page first/last, steps, dim outside, transition, margin)
// live in localStorage per browser and are edited in the reader's settings dialog (GuidedSettingsSection).
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { detectPanels, type Rect } from "@/lib/panel-detect"
import { buildSteps, DEFAULT_GUIDED, FULL, needsBubbles, type GuidedSettings } from "@/lib/guided-steps"
import { detectBubblesInBrowser } from "@/lib/bubble-detect-client"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const DETECT_WIDTH = 1600      // detectPanels works on half of it, and on all of it for hairline gutters
const cache = new Map<string, Rect[]>()
const bubbleCache = new Map<string, Promise<Rect[]>>()
const bubblesOf = (img: HTMLImageElement, src: string) => {
    if (!bubbleCache.has(src)) bubbleCache.set(src, detectBubblesInBrowser(img))
    return bubbleCache.get(src)!
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

// The model needs ~2 s per page in the browser (WebAssembly, one thread): work out the next page while this one is
// read, so its bubbles are ready when the reader gets there — only if the settings will use them there.
async function prefetch(src: string, rtl: boolean, mode: GuidedSettings['mode']) {
    if (mode === 'panels' || bubbleCache.has(src)) return
    const img = new Image()
    img.src = src
    try { await img.decode() } catch { return }
    if (needsBubbles(await panelsOf(img, src, rtl), mode)) await bubblesOf(img, src)
}

const STORAGE_KEY = 'omnibus-guided-settings'
export function useGuidedSettings(): [GuidedSettings, (s: GuidedSettings) => void] {
    const [settings, setSettings] = useState<GuidedSettings>(DEFAULT_GUIDED)
    useEffect(() => {
        try { setSettings({ ...DEFAULT_GUIDED, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }) } catch { /* private mode */ }
    }, [])
    const save = (s: GuidedSettings) => {
        setSettings(s)
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* private mode */ }
    }
    return [settings, save]
}

const MARGIN = { tight: 0.99, normal: 0.96, wide: 0.86 }
const DURATION = { smooth: 450, fast: 150, off: 0 }

export function GuidedView({ src, nextSrc, rtl, enterAtEnd, onNextPage, onPrevPage, onToggleUI, imgStyle, settings }: {
    src: string
    nextSrc?: string               // the page after this one: its detection runs in the background
    rtl: boolean
    enterAtEnd: boolean            // came back from the next page: start on the last step
    onNextPage: () => void
    onPrevPage: () => void
    onToggleUI: () => void
    imgStyle?: React.CSSProperties // brightness / contrast from the reader settings
    settings: GuidedSettings
}) {
    const boxRef = useRef<HTMLDivElement>(null)
    const imgRef = useRef<HTMLImageElement>(null)
    const [steps, setSteps] = useState<Rect[]>([FULL])
    const [step, setStep] = useState(0)
    const [natural, setNatural] = useState<{ w: number, h: number } | null>(null)
    const [box, setBox] = useState({ w: 0, h: 0 })
    // While the model works on this page, "next" on its last known step waits instead of leaving the page
    const [detecting, setDetecting] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const waitingNext = useRef(false)
    const stepRef = useRef(0)
    useEffect(() => { stepRef.current = step }, [step])
    const mounted = useRef(true)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

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
        const base = buildSteps(panels, [], settings, rtl)
        setSteps(base)
        setStep(enterAtEnd ? base.length - 1 : 0)
        if (nextSrc) prefetch(nextSrc, rtl, settings.mode)  // queued behind this page in the worker
        if (!needsBubbles(panels, settings.mode)) return
        // Bubbles arrive later; they must not move the reader: the step being shown stays the current step
        setDetecting(true)
        const bubbles = await bubblesOf(img, src)
        if (!mounted.current) return
        setDetecting(false)
        const all = bubbles.length ? buildSteps(panels, bubbles, settings, rtl) : base
        const waited = waitingNext.current
        waitingNext.current = false
        setWaiting(false)
        if (all.length !== base.length || all.some((r, i) => r !== base[i])) setSteps(all)
        const s = stepRef.current, shown = base[s]
        let at = s === base.length - 1 && enterAtEnd && !waited ? all.length - 1
            : shown === FULL ? (s === 0 ? all.indexOf(FULL) : all.lastIndexOf(FULL)) : all.indexOf(shown)
        if (at < 0) at = 0
        // "Next" was pressed while the bubbles were still being found: take that step now
        if (waited && at + 1 >= all.length) { setStep(at); onNextPage() }
        else setStep(waited ? at + 1 : at)
    }

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

    // Fit the current step into the viewport with the chosen margin, centred
    const current = steps[Math.min(step, steps.length - 1)]
    let transform = 'none', frame: React.CSSProperties | null = null
    if (natural && box.w && box.h) {
        const pw = current.w * natural.w, ph = current.h * natural.h
        const s = Math.min(box.w * MARGIN[settings.margin] / pw, box.h * MARGIN[settings.margin] / ph)
        const tx = box.w / 2 - (current.x * natural.w + pw / 2) * s
        const ty = box.h / 2 - (current.y * natural.h + ph / 2) * s
        transform = `translate(${tx}px, ${ty}px) scale(${s})`
        frame = { left: tx + current.x * natural.w * s, top: ty + current.y * natural.h * s, width: pw * s, height: ph * s }
    }
    const transition = DURATION[settings.transition] ? `${DURATION[settings.transition]}ms ease-out` : undefined
    const inner = steps.filter(r => r !== FULL).length
    const innerIndex = steps.slice(0, step + 1).filter(r => r !== FULL).length

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
                className="absolute top-0 left-0 max-w-none origin-top-left motion-reduce:transition-none"
                style={{ ...imgStyle, transform, transition: transition && `transform ${transition}`, visibility: natural ? 'visible' : 'hidden' }} />
            {/* the art around the current step, dimmed or blacked out (Guided View's letterbox) */}
            {frame && settings.outside !== 'show' && current !== FULL && (
                <div className="absolute pointer-events-none z-10 motion-reduce:transition-none"
                    style={{ ...frame, boxShadow: `0 0 0 200vmax rgba(0,0,0,${settings.outside === 'black' ? 1 : 0.65})`, transition: transition && `all ${transition}` }} />
            )}
            {/* tap zones: back / menu / forward */}
            <button type="button" aria-label="Zurück" className="absolute inset-y-0 left-0 w-[30%] z-20 bg-transparent" onClick={rtl ? next : prev} />
            <button type="button" aria-label="Menü" className="absolute inset-y-0 left-[30%] w-[40%] z-20 bg-transparent" onClick={onToggleUI} />
            <button type="button" aria-label="Weiter" className="absolute inset-y-0 right-0 w-[30%] z-20 bg-transparent" onClick={rtl ? prev : next} />
            {waiting && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 text-[11px] font-bold text-white/80 bg-black/60 rounded px-2 py-0.5 pointer-events-none">
                    Sprechblasen werden erkannt…
                </div>
            )}
            {inner > 0 && (
                <div className="absolute bottom-3 right-3 z-30 text-[11px] font-bold text-white/70 bg-black/50 rounded px-1.5 py-0.5 pointer-events-none">
                    {current === FULL ? 'Seite' : `${innerIndex}/${inner}`}
                </div>
            )}
        </div>
    )
}

/** The guided view's options in the reader's settings dialog. */
export function GuidedSettingsSection({ value, onChange }: { value: GuidedSettings, onChange: (s: GuidedSettings) => void }) {
    const field = <K extends keyof GuidedSettings>(key: K, label: string, options: [GuidedSettings[K], string][]) => (
        <div className="space-y-1.5">
            <Label className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground font-bold">{label}</Label>
            <Select value={value[key]} onValueChange={v => onChange({ ...value, [key]: v as GuidedSettings[K] })}>
                <SelectTrigger className="h-10 text-xs sm:text-sm border-border bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                    {options.map(([v, l]) => <SelectItem key={v} value={v} className="focus:bg-primary/10 focus:text-primary">{l}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
    )
    return (
        <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-sm font-black">Panel-Ansicht (Lupe)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field('mode', 'Schritte', [['auto', 'Panels + Sprechblasen'], ['panels', 'Nur Panels'], ['bubbles', 'Nur Sprechblasen']])}
                {field('fullPage', 'Ganze Seite zeigen', [['start', 'Am Anfang'], ['end', 'Am Ende'], ['both', 'Anfang und Ende'], ['never', 'Nie']])}
                {field('outside', 'Außerhalb des Ausschnitts', [['show', 'Sichtbar'], ['dim', 'Abgedunkelt'], ['black', 'Schwarz']])}
                {field('transition', 'Übergang', [['smooth', 'Weich'], ['fast', 'Schnell'], ['off', 'Ohne Animation']])}
                {field('margin', 'Abstand beim Zoomen', [['tight', 'Eng'], ['normal', 'Normal'], ['wide', 'Weit']])}
            </div>
        </div>
    )
}
