// src/lib/panel-detect.ts
//
// Fork only: panel detection for the reader's guided view (src/components/guided-view.tsx). ComiXology's Guided View is
// authored by hand per issue; this finds panels automatically from the gutters, like the open-source Kumiko does:
//   1. gutter pixels: close to white, black or the page's border colour, in strips at least a few pixels thick
//      (an opening removes the thin ink lines of the artwork, wide gutters survive)
//   2. panels: the connected areas between the gutters, as bounding boxes; specks dropped, boxes inside boxes merged
//   3. reading order: rows of boxes that overlap vertically, top to bottom; inside a row left to right
//      (right to left for manga)
// Two passes: the first on a half-size copy for regular gutters (tested on golden age to 2025 pages); only when it
// finds nothing, a second on the full ~1600 px image for hairline gutters between diagonal panels (Absolute Wonder Woman:
// 2 px of white between black borders at 800 px), kept only if its panels are solid shapes.
// A page where this finds fewer than two panels (splash, art bleeding across every border) stays one full-page step.
// Pure arithmetic on RGBA pixels so it runs in the browser on a downscaled canvas and is testable in Node.

export type Rect = { x: number; y: number; w: number; h: number };  // fractions of the page, 0..1

type Img = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
type Box = { x0: number; y0: number; x1: number; y1: number; area: number };  // pixels, x1/y1 exclusive

const MIN_PANEL = 0.015;   // components below 1.5 % of the page are specks, balloons or captions, not panels
const MAX_PANELS = 20;     // more than that: the art fell apart into pieces, show the page instead

type Pass = { white: number };  // luminance above which a pixel counts as a white gutter
const THICK: Pass = { white: 232 };
const THIN: Pass = { white: 200 };  // the grey anti-aliased edge of a hairline gutter counts too

function gutterMask(img: Img, pass: Pass): Uint8Array {
    const { width: w, height: h, data } = img;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    const border: number[] = [];
    for (let x = 0; x < w; x++) border.push(lum[x], lum[(h - 1) * w + x]);
    for (let y = 0; y < h; y++) border.push(lum[y * w], lum[y * w + w - 1]);
    border.sort((a, b) => a - b);
    const bg = border[Math.floor(border.length / 2)];
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) raw[i] = lum[i] > pass.white || lum[i] < 40 || Math.abs(lum[i] - bg) < 24 ? 1 : 0;
    // Opening with a (2r+1)² square: erode, then dilate — strips thinner than the square vanish
    const r = 1;
    const erode = (src: Uint8Array, keep: number) => {
        const out = new Uint8Array(w * h);
        // separable: rows then columns
        const tmp = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let v = keep;
            for (let d = -r; d <= r && v === keep; d++) { const xx = x + d; const s = xx < 0 || xx >= w ? keep : src[y * w + xx]; if (s !== keep) v = s; }
            tmp[y * w + x] = v;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let v = keep;
            for (let d = -r; d <= r && v === keep; d++) { const yy = y + d; const s = yy < 0 || yy >= h ? keep : tmp[yy * w + x]; if (s !== keep) v = s; }
            out[y * w + x] = v;
        }
        return out;
    };
    return erode(erode(raw, 1), 0);  // erode the gutter (1), then grow it back (erode the content, 0)
}

/** Bounding boxes of 4-connected non-gutter components. */
function components(mask: Uint8Array, w: number, h: number): Box[] {
    const label = new Int32Array(w * h).fill(-1);
    const boxes: Box[] = [];
    const stack: number[] = [];
    for (let start = 0; start < w * h; start++) {
        if (mask[start] || label[start] >= 0) continue;
        const b: Box = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
        label[start] = boxes.length;
        stack.push(start);
        while (stack.length) {
            const i = stack.pop()!;
            const x = i % w, y = (i - x) / w;
            b.area++;
            if (x < b.x0) b.x0 = x; if (x >= b.x1) b.x1 = x + 1; if (y < b.y0) b.y0 = y; if (y >= b.y1) b.y1 = y + 1;
            for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
                if (n >= 0 && !mask[n] && label[n] < 0) { label[n] = boxes.length; stack.push(n); }
            }
        }
        boxes.push(b);
    }
    return boxes;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const size = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), area: a.area + b.area });
const gap = (a: Box, b: Box) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));

/**
 * Slivers (under 8 % of the page across) are pieces of a panel that a light line in the art cut off — a door frame,
 * a window. Each joins the nearby box it forms the most compact rectangle with.
 */
function mergeSlivers(boxes: Box[], w: number, h: number): Box[] {
    const list = [...boxes];
    for (;;) {
        const sliver = list.filter(b => Math.min((b.x1 - b.x0) / w, (b.y1 - b.y0) / h) < 0.08).sort((a, c) => size(a) - size(c))[0];
        if (!sliver) return list;
        let target: Box | null = null, cost = Infinity;
        for (const o of list) {
            if (o === sliver || gap(o, sliver) > 0.03 * Math.min(w, h)) continue;
            const c = size(union(o, sliver)) - size(o) - size(sliver);
            if (c < cost) { cost = c; target = o; }
        }
        list.splice(list.indexOf(sliver), 1);  // an isolated sliver is dropped
        if (target) list[list.indexOf(target)] = union(target, sliver);
    }
}

/** Reading order: rows of vertically overlapping boxes, top to bottom; within a row by x. */
function readingOrder(boxes: Box[], rtl: boolean): Box[] {
    const rows: Box[][] = [];
    for (const b of [...boxes].sort((a, c) => a.y0 - c.y0)) {
        const row = rows.find(r => r.some(o => Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) > 0.5 * Math.min(o.y1 - o.y0, b.y1 - b.y0)));
        if (row) row.push(b); else rows.push([b]);
    }
    rows.sort((a, c) => Math.min(...a.map(b => b.y0)) - Math.min(...c.map(b => b.y0)));
    return rows.flatMap(r => r.sort((a, c) => rtl ? c.x1 - a.x1 : a.x0 - c.x0));
}

/**
 * Real panels tile the page; art with large black or white areas (dark scenes on black gutters, sketches on white)
 * falls apart into pieces whose boxes pile onto each other instead. Those pages stay whole. Tested on 31 pages from
 * 1939 to 2025: real pages overlap 0–4 % (L-shaped panels), the broken ones more.
 */
function plausible(boxes: Box[], w: number, h: number): boolean {
    const page = w * h;
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) overlaps += overlap(boxes[i], boxes[j]);
    if (overlaps > 0.06 * page) return false;                                    // pieces stacked on each other
    return boxes.reduce((sum, b) => sum + size(b), 0) - overlaps >= 0.5 * page;  // together they cover the page
}

/** Thin pass: diagonal panels overlap as boxes, so only ask that they are solid shapes and cover the page. */
function solid(boxes: Box[], w: number, h: number): boolean {
    const fills = boxes.map(b => b.area / size(b)).sort((a, c) => a - c);
    const covered = boxes.reduce((sum, b) => sum + b.area, 0);
    return fills[fills.length >> 1] >= 0.5 && covered >= 0.4 * w * h;
}

function half(img: Img): Img {
    const w = img.width >> 1, h = img.height >> 1, src = img.data, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
        const i = ((2 * y) * img.width + 2 * x) * 4 + c, j = i + img.width * 4;
        data[(y * w + x) * 4 + c] = (src[i] + src[i + 4] + src[j] + src[j + 4]) >> 2;
    }
    return { width: w, height: h, data };
}

function pass(img: Img, p: Pass, check: (b: Box[], w: number, h: number) => boolean): Box[] {
    const { width: w, height: h } = img;
    const mask = gutterMask(img, p);
    let boxes = components(mask, w, h).filter(b => size(b) >= MIN_PANEL * w * h);
    // A component inside another's box (an inset, a balloon cut free) belongs to that panel
    const dropContained = (list: Box[]) => list.filter(b => !list.some(o => o !== b && size(o) > size(b) && overlap(o, b) > 0.8 * size(b)));
    boxes = dropContained(mergeSlivers(dropContained(boxes), w, h));
    return boxes.length >= 2 && boxes.length <= MAX_PANELS && check(boxes, w, h) ? boxes : [];
}

/**
 * Panels of a page in reading order, as fractions of the page. Empty when fewer than two panels are found or the art
 * fell apart into too many pieces — the guided view then shows the whole page. Give it the page at ~1600 px wide.
 */
export function detectPanels(img: Img, opts: { rtl?: boolean } = {}): Rect[] {
    if (img.width < 16 || img.height < 16) return [];
    const big = img.width >= 1000;
    const small = big ? half(img) : img;
    let boxes = pass(small, THICK, plausible);
    let scale = { w: small.width, h: small.height };
    if (!boxes.length && big) { boxes = pass(img, THIN, solid); scale = { w: img.width, h: img.height }; }
    return readingOrder(boxes, !!opts.rtl).map(b => ({ x: b.x0 / scale.w, y: b.y0 / scale.h, w: (b.x1 - b.x0) / scale.w, h: (b.y1 - b.y0) / scale.h }));
}
