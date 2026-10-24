// __tests__/lib/guided-steps.test.ts
import { describe, it, expect } from 'vitest';
import { aroundBubble, buildSteps, FULL, guidedSteps, needsBubbles } from '@/lib/guided-steps';

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
// which input bubble a step shows: the one inside the step's frame closest to its centre (frames shift at page edges)
const which = (steps: ReturnType<typeof guidedSteps>, bubbles: ReturnType<typeof r>[]) => steps.map(s => {
    const inFrame = bubbles.map((b, i) => ({ b, i })).filter(({ b }) => b.x >= s.x - 1e-9 && b.y >= s.y - 1e-9 && b.x + b.w <= s.x + s.w + 1e-9 && b.y + b.h <= s.y + s.h + 1e-9);
    const d = (b: ReturnType<typeof r>) => Math.hypot(b.x + b.w / 2 - (s.x + s.w / 2), b.y + b.h / 2 - (s.y + s.h / 2));
    return inFrame.sort((p, q) => d(p.b) - d(q.b))[0]?.i ?? -1;
});

describe('lib/guided-steps', () => {
    // Absolute Wonder Woman #4 p. 11: no panel grid, five balloons
    const p11 = [r(0.72, 0.27, 0.15, 0.05), r(0.35, 0.31, 0.07, 0.03), r(0.25, 0.57, 0.08, 0.03), r(0.73, 0.55, 0.15, 0.07), r(0.43, 0.84, 0.14, 0.08)];

    it('steps through the bubbles of a page without panels, top to bottom and left to right', () => {
        // HUFF (left, a bit lower) before VISIONS (right): same row, read left to right
        expect(which(guidedSteps([], p11), p11)).toEqual([1, 0, 2, 3, 4]);
    });

    it('goes right to left for manga', () => {
        expect(which(guidedSteps([], p11, true), p11)).toEqual([0, 1, 3, 2, 4]);
    });

    it('needs two bubbles to guide a page without panels', () => {
        expect(guidedSteps([], [p11[0]])).toEqual([]);
    });

    it('adds the bubbles of a big panel after it, small panels stay one step', () => {
        const panels = [r(0, 0, 1, 0.6), r(0, 0.62, 0.5, 0.38)];
        const bubbles = [r(0.6, 0.1, 0.1, 0.05), r(0.1, 0.1, 0.1, 0.05), r(0.1, 0.7, 0.1, 0.05), r(0.3, 0.8, 0.1, 0.05)];
        const steps = guidedSteps(panels, bubbles);
        expect(steps).toHaveLength(4);
        expect(steps[0]).toEqual(panels[0]);
        expect(which(steps.slice(1, 3), bubbles)).toEqual([1, 0]);
        expect(steps[3]).toEqual(panels[1]);
    });

    it('shows a bubble with its surroundings, inside the page', () => {
        const v = aroundBubble(r(0.9, 0.95, 0.08, 0.04));
        expect(v.w).toBeCloseTo(0.4); expect(v.x + v.w).toBeCloseTo(1); expect(v.y + v.h).toBeCloseTo(1);
    });
});

describe('lib/guided-steps close balloons', () => {
    it('shows balloons that would cut each other in one step, so none is cut and skipped', () => {
        // two balloons of one exchange right next to each other, a third far below
        const b = [r(0.30, 0.20, 0.12, 0.06), r(0.45, 0.22, 0.12, 0.06), r(0.40, 0.80, 0.12, 0.06)];
        const steps = guidedSteps([], b);
        expect(steps).toHaveLength(2);
        for (const x of b.slice(0, 2)) {
            expect(steps[0].x).toBeLessThanOrEqual(x.x); expect(steps[0].x + steps[0].w).toBeGreaterThanOrEqual(x.x + x.w);
        }
    });

    it('keeps far-apart balloons as their own steps', () => {
        const b = [r(0.05, 0.05, 0.1, 0.05), r(0.80, 0.50, 0.1, 0.05), r(0.10, 0.90, 0.1, 0.05)];
        expect(guidedSteps([], b)).toHaveLength(3);
    });
});

describe('lib/guided-steps settings', () => {
    const panels = [r(0, 0, 1, 0.45), r(0, 0.5, 0.48, 0.5), r(0.52, 0.5, 0.48, 0.5)];
    const bubbles = [r(0.1, 0.1, 0.1, 0.05), r(0.7, 0.1, 0.1, 0.05), r(0.1, 0.7, 0.1, 0.05)];

    it('puts the whole page first, last, both or nowhere', () => {
        expect(buildSteps(panels, [], { fullPage: 'start', mode: 'panels' })).toEqual([FULL, ...panels]);
        expect(buildSteps(panels, [], { fullPage: 'end', mode: 'panels' })).toEqual([...panels, FULL]);
        expect(buildSteps(panels, [], { fullPage: 'both', mode: 'panels' })).toEqual([FULL, ...panels, FULL]);
        expect(buildSteps(panels, [], { fullPage: 'never', mode: 'panels' })).toEqual(panels);
    });

    it('keeps the whole page as the one step when nothing was found', () => {
        expect(buildSteps([], [], { fullPage: 'never', mode: 'auto' })).toEqual([FULL]);
    });

    it('steps through bubbles everywhere in bubble mode, falling back to panels', () => {
        expect(buildSteps(panels, bubbles, { fullPage: 'never', mode: 'bubbles' })).toHaveLength(3);
        expect(buildSteps(panels, [], { fullPage: 'never', mode: 'bubbles' })).toEqual(panels);
    });

    it('asks for the model only when the settings use bubbles', () => {
        expect(needsBubbles(panels, 'panels')).toBe(false);
        expect(needsBubbles([r(0, 0, 0.5, 0.5), r(0.5, 0.5, 0.5, 0.5)], 'auto')).toBe(false);
        expect(needsBubbles([], 'auto')).toBe(true);
        expect(needsBubbles(panels, 'bubbles')).toBe(true);
    });
});
