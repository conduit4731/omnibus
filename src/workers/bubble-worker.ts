// Fork only: speech-bubble detection for the reader's guided view, off the main thread. A YOLOv8 segmentation model
// (kitsumed/yolov8m_seg-speech-bubble, GPL-3.0, exported to ONNX at 640 px and int8-quantized: 28 MB) run with
// onnxruntime-web; only the boxes are used, not the masks. The model is served by /api/models from /config/models,
// the runtime's WebAssembly from /ort (copied there by the Dockerfile).
/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'

ort.env.wasm.wasmPaths = '/ort/'
ort.env.wasm.numThreads = 1  // threads need cross-origin isolation, which Omnibus doesn't serve

const MODEL = '/api/models/speech-bubbles-v1.onnx'
const SIZE = 640, CONF = 0.45, IOU = 0.45

let session: Promise<ort.InferenceSession> | null = null
const getSession = () => session ??= fetch(MODEL)
    .then(r => { if (!r.ok) throw new Error(`model HTTP ${r.status}`); return r.arrayBuffer() })
    .then(buf => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }))
    .catch(e => { session = null; throw e })

export type BubbleJob = { id: number; pixels: Uint8ClampedArray; scale: number; padX: number; padY: number; width: number; height: number }
type Box = [number, number, number, number, number]  // x0, y0, x1, y1 (640-letterbox px), score

function nms(boxes: Box[]): Box[] {
    const kept: Box[] = []
    for (const b of boxes.sort((a, c) => c[4] - a[4])) {
        const clash = kept.some(k => {
            const ix = Math.max(0, Math.min(k[2], b[2]) - Math.max(k[0], b[0])), iy = Math.max(0, Math.min(k[3], b[3]) - Math.max(k[1], b[1]))
            const inter = ix * iy
            return inter / ((k[2] - k[0]) * (k[3] - k[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter) > IOU
        })
        if (!clash) kept.push(b)
    }
    return kept
}

// One job at a time: the reader prefetches the next page while this one runs, and a session must not run twice at once
let queue: Promise<void> = Promise.resolve()
self.onmessage = (e: MessageEvent<BubbleJob>) => { queue = queue.then(() => handle(e.data)) }

async function handle({ id, pixels, scale, padX, padY, width, height }: BubbleJob) {
    try {
        const plane = SIZE * SIZE, input = new Float32Array(3 * plane)
        for (let i = 0; i < plane; i++) {
            input[i] = pixels[i * 4] / 255; input[plane + i] = pixels[i * 4 + 1] / 255; input[2 * plane + i] = pixels[i * 4 + 2] / 255
        }
        const s = await getSession()
        const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) })
        const o = out[s.outputNames[0]].data as Float32Array  // [1, 37, 8400]: cx, cy, w, h, score, 32 mask coefficients
        const n = out[s.outputNames[0]].dims[2]
        const boxes: Box[] = []
        for (let j = 0; j < n; j++) {
            const score = o[4 * n + j]
            if (score < CONF) continue
            const cx = o[j], cy = o[n + j], w = o[2 * n + j], h = o[3 * n + j]
            boxes.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, score])
        }
        // The model also takes faces (and other round shapes) for balloons, some with high confidence. A balloon holds
        // text: a lot of white (or, for white-on-black balloons, black) behind it. Faces are skin tones in between.
        // Measured on Absolute Wonder Woman #4 and others: balloons ≥ 31 % light or ≥ 66 % dark, faces ≤ 8 % light, ≤ 29 % dark.
        const lettered = ([x0, y0, x1, y1]: Box) => {
            let light = 0, dark = 0, n = 0
            for (let y = Math.max(0, Math.floor(y0)); y < Math.min(SIZE, Math.ceil(y1)); y++)
                for (let x = Math.max(0, Math.floor(x0)); x < Math.min(SIZE, Math.ceil(x1)); x++) {
                    const i = (y * SIZE + x) * 4, lum = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000
                    if (lum > 200) light++; else if (lum < 60) dark++
                    n++
                }
            return n > 0 && (light / n >= 0.25 || dark / n >= 0.45)
        }
        // letterbox px -> fractions of the page
        const bubbles = nms(boxes).filter(lettered).map(([x0, y0, x1, y1]) => {
            const fx0 = Math.max(0, (x0 - padX) / scale / width), fy0 = Math.max(0, (y0 - padY) / scale / height)
            const fx1 = Math.min(1, (x1 - padX) / scale / width), fy1 = Math.min(1, (y1 - padY) / scale / height)
            return { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 }
        }).filter(b => b.w > 0 && b.h > 0)
        self.postMessage({ id, bubbles })
    } catch (err) {
        self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
}
