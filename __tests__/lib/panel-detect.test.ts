// __tests__/lib/panel-detect.test.ts
import { describe, it, expect } from 'vitest';
import { detectPanels } from '@/lib/panel-detect';

// A page of the given size in background colour bg, with filled rectangles (pixels) as "panels"
function page(w: number, h: number, rects: [number, number, number, number][], bg = 255, ink = 40) {
    const data = new Uint8ClampedArray(w * h * 4).fill(bg);
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = ink;
    }
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { width: w, height: h, data };
}
const round = (r: { x: number, y: number }) => [Math.round(r.x * 100), Math.round(r.y * 100)];

describe('lib/panel-detect', () => {
    // Classic layout: one wide panel on top, two side by side below
    const layout: [number, number, number, number][] = [[10, 10, 190, 100], [10, 110, 95, 290], [105, 110, 190, 290]];

    it('finds the panels of a grid page in reading order', () => {
        const panels = detectPanels(page(200, 300, layout));
        expect(panels).toHaveLength(3);
        expect(panels.map(round)).toEqual([[5, 3], [5, 37], [53, 37]]);
    });

    it('reads a row right to left for manga', () => {
        const panels = detectPanels(page(200, 300, layout), { rtl: true });
        expect(panels.map(round)).toEqual([[5, 3], [53, 37], [5, 37]]);
    });

    it('works on black gutters too', () => {
        expect(detectPanels(page(200, 300, layout, 0, 200))).toHaveLength(3);
    });

    it('nests: a column split inside a row split inside a column', () => {
        const nested: [number, number, number, number][] = [[10, 10, 190, 90], [10, 100, 60, 290], [70, 100, 190, 190], [70, 200, 190, 290]];
        expect(detectPanels(page(200, 300, nested)).map(round)).toEqual([[5, 3], [5, 33], [35, 33], [35, 67]]);
    });

    it('leaves a splash page whole', () => {
        expect(detectPanels(page(200, 300, [[10, 10, 190, 290]]))).toEqual([]);
    });

    it('does not cut through art that crosses the gutter', () => {
        // the second row's panels are joined by a figure reaching across the gap
        const crossing: [number, number, number, number][] = [[10, 10, 190, 100], [10, 110, 95, 290], [105, 110, 190, 290], [90, 150, 110, 170]];
        expect(detectPanels(page(200, 300, crossing))).toHaveLength(2);
    });

    it('ignores specks and refuses noise', () => {
        expect(detectPanels(page(200, 300, [...layout, [195, 295, 197, 297]]))).toHaveLength(3);
        const confetti: [number, number, number, number][] = [];
        for (let y = 0; y < 10; y++) for (let x = 0; x < 6; x++) confetti.push([5 + x * 32, 5 + y * 29, 30 + x * 32, 30 + y * 29]);
        expect(detectPanels(page(200, 300, confetti))).toEqual([]);
    });
});

describe('lib/panel-detect slivers', () => {
    it('joins a sliver cut off by a light line in the art to its panel', () => {
        // second row: one panel split by a 4px white vertical line near its left edge
        const split: [number, number, number, number][] = [[10, 10, 190, 100], [10, 110, 20, 290], [24, 110, 190, 290]];
        const panels = detectPanels(page(200, 300, split));
        expect(panels).toHaveLength(2);
        expect(Math.round(panels[1].x * 100)).toBe(5);
    });
});

describe('lib/panel-detect plausibility', () => {
    it('shows the whole page when the pieces are not a panel grid', () => {
        // two interlocking L shapes: their pixels never touch, their boxes overlap by half the page
        const ls: [number, number, number, number][] = [[10, 10, 190, 45], [10, 10, 45, 200], [10, 215, 190, 290], [155, 60, 190, 290]];
        expect(detectPanels(page(200, 300, ls))).toEqual([]);
    });
});
