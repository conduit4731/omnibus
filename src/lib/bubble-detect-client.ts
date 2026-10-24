// Fork only: main-thread side of the speech-bubble worker (src/workers/bubble-worker.ts). Letterboxes the page into a
// 640×640 canvas like YOLO expects and hands the pixels to the worker. Any failure (no Worker, model missing, slow
// device) resolves to no bubbles: the guided view then keeps panels or the whole page.
import type { Rect } from '@/lib/panel-detect'

const SIZE = 640, TIMEOUT_MS = 20000
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: Rect[]) => void>()

function getWorker(): Worker | null {
    if (worker || typeof Worker === 'undefined') return worker
    worker = new Worker(new URL('../workers/bubble-worker.ts', import.meta.url))
    worker.onmessage = (e: MessageEvent<{ id: number, bubbles?: Rect[], error?: string }>) => {
        if (e.data.error) console.warn('[guided view] bubble detection:', e.data.error)
        pending.get(e.data.id)?.(e.data.bubbles || [])
        pending.delete(e.data.id)
    }
    return worker
}

export function detectBubblesInBrowser(img: HTMLImageElement): Promise<Rect[]> {
    const w = getWorker()
    if (!w || !img.naturalWidth) return Promise.resolve([])
    const scale = SIZE / Math.max(img.naturalWidth, img.naturalHeight)
    const dw = Math.round(img.naturalWidth * scale), dh = Math.round(img.naturalHeight * scale)
    const padX = Math.floor((SIZE - dw) / 2), padY = Math.floor((SIZE - dh) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return Promise.resolve([])
    ctx.fillStyle = 'rgb(114,114,114)'
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.drawImage(img, padX, padY, dw, dh)
    let pixels: Uint8ClampedArray
    try { pixels = ctx.getImageData(0, 0, SIZE, SIZE).data } catch { return Promise.resolve([]) }
    const id = ++seq
    return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve([]) }, TIMEOUT_MS)
        pending.set(id, r => { clearTimeout(timer); resolve(r) })
        w.postMessage({ id, pixels, scale, padX, padY, width: img.naturalWidth, height: img.naturalHeight }, [pixels.buffer])
    })
}
