// __tests__/lib/guided-steps.test.ts
import { describe, it, expect } from 'vitest';
import { aroundBubble, bubbleSteps, buildSteps, closestStep, FULL, guidedSteps, needsBubbles } from '@/lib/guided-steps';

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const cuts = (step: ReturnType<typeof r>, b: ReturnType<typeof r>) => {
    const ix = Math.min(step.x + step.w, b.x + b.w) - Math.max(step.x, b.x), iy = Math.min(step.y + step.h, b.y + b.h) - Math.max(step.y, b.y);
    const whole = b.x >= step.x - 1e-9 && b.y >= step.y - 1e-9 && b.x + b.w <= step.x + step.w + 1e-9 && b.y + b.h <= step.y + step.h + 1e-9;
    return ix > 0 && iy > 0 && !whole;
};
const coverage = (steps: ReturnType<typeof r>[]) => {
    let hit = 0;
    for (let y = 0.005; y < 1; y += 0.01) for (let x = 0.005; x < 1; x += 0.01)
        if (steps.some(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)) hit++;
    return hit / 10000;
};

describe('lib/guided-steps', () => {
    // Absolute Wonder Woman #4 p. 11: no panel grid, five balloons
    const p11 = [r(0.72, 0.27, 0.15, 0.05), r(0.35, 0.31, 0.07, 0.03), r(0.25, 0.57, 0.08, 0.03), r(0.73, 0.55, 0.15, 0.07), r(0.43, 0.84, 0.14, 0.08)];

    it('shows all of a page without panels in parts, no balloon cut', () => {
        const steps = guidedSteps([], p11);
        expect(steps.length).toBeGreaterThanOrEqual(3);
        expect(coverage(steps)).toBe(1);
        for (const s of steps) for (const b of p11) expect(cuts(s, b)).toBe(false);
        for (const s of steps) expect(s.h).toBeLessThanOrEqual(0.5);
    });

    it('reads parts top to bottom, a split row left to right, right to left for manga', () => {
        const ltr = guidedSteps([], p11), rtl = guidedSteps([], p11, true);
        for (let i = 1; i < ltr.length; i++) expect(ltr[i].y).toBeGreaterThanOrEqual(ltr[i - 1].y);
        const row = ltr.findIndex((s, i) => i > 0 && s.y === ltr[i - 1].y);
        expect(row).toBeGreaterThan(0);
        expect(ltr[row].x).toBeGreaterThan(ltr[row - 1].x);
        expect(rtl[row].x).toBeLessThan(rtl[row - 1].x);
    });

    it('leaves a page without panels and without balloons whole', () => {
        expect(guidedSteps([], [])).toEqual([]);
    });

    it('shows a big panel with balloons, then its parts; small panels stay one step', () => {
        const panels = [r(0, 0, 1, 0.6), r(0, 0.62, 0.5, 0.38)];
        const bubbles = [r(0.6, 0.05, 0.1, 0.05), r(0.1, 0.05, 0.1, 0.05), r(0.1, 0.45, 0.1, 0.05), r(0.1, 0.7, 0.1, 0.05)];
        const steps = guidedSteps(panels, bubbles);
        expect(steps[0]).toEqual(panels[0]);
        expect(steps.length).toBeGreaterThanOrEqual(4);
        expect(steps[steps.length - 1]).toEqual(panels[1]);
        for (const s of steps) for (const b of bubbles) expect(cuts(s, b)).toBe(false);
    });

    it('grows a panel to take in a balloon reaching over its edge', () => {
        const panels = [r(0, 0, 1, 0.25), r(0, 0.27, 1, 0.25)];
        const over = r(0.4, 0.22, 0.15, 0.08);  // most of it in the first panel, the rest over the gutter
        const [first] = guidedSteps(panels, [over]);
        expect(first.y + first.h).toBeCloseTo(0.30);
    });

    it('shows a bubble with its surroundings, inside the page', () => {
        const v = aroundBubble(r(0.9, 0.95, 0.08, 0.04));
        expect(v.w).toBeCloseTo(0.4); expect(v.x + v.w).toBeCloseTo(1); expect(v.y + v.h).toBeCloseTo(1);
    });
});

describe('lib/guided-steps bubble mode, close balloons', () => {
    it('shows balloons that would cut each other in one step, so none is cut and skipped', () => {
        // two balloons of one exchange right next to each other, a third far below
        const b = [r(0.30, 0.20, 0.12, 0.06), r(0.45, 0.22, 0.12, 0.06), r(0.40, 0.80, 0.12, 0.06)];
        const steps = bubbleSteps(b, false);
        expect(steps).toHaveLength(2);
        for (const x of b.slice(0, 2)) {
            expect(steps[0].x).toBeLessThanOrEqual(x.x); expect(steps[0].x + steps[0].w).toBeGreaterThanOrEqual(x.x + x.w);
        }
    });

    it('keeps far-apart balloons as their own steps', () => {
        const b = [r(0.05, 0.05, 0.1, 0.05), r(0.80, 0.50, 0.1, 0.05), r(0.10, 0.90, 0.1, 0.05)];
        expect(bubbleSteps(b, false)).toHaveLength(3);
    });
});

describe('lib/guided-steps refined steps', () => {
    it('finds the step showing most of the one on screen', () => {
        const steps = [FULL, r(0, 0, 1, 0.32), r(0, 0.3, 0.5, 0.4), r(0.5, 0.3, 0.5, 0.4)];
        expect(closestStep(steps, r(0.52, 0.31, 0.48, 0.38))).toBe(3);
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
        expect(needsBubbles('panels')).toBe(false);
        expect(needsBubbles('auto')).toBe(true);
        expect(needsBubbles('bubbles')).toBe(true);
    });
});

describe('lib/guided-steps peek', () => {
    it('starts with the whole page when it is shown briefly', () => {
        const p = [r(0, 0, 1, 0.5), r(0, 0.5, 1, 0.5)];
        expect(buildSteps(p, [], { fullPage: 'peek', mode: 'panels' })).toEqual([FULL, ...p]);
    });
});

describe('lib/guided-steps balloons everywhere', () => {
    it('ends rows below the balloons when no gap is in reach, and finishes', () => {
        // stacked balloons with no gap between them over most of the page
        const b = [r(0.1, 0.05, 0.3, 0.3), r(0.5, 0.3, 0.3, 0.3), r(0.1, 0.55, 0.3, 0.3)];
        const steps = guidedSteps([], b);
        expect(coverage(steps)).toBe(1);
        for (const s of steps) for (const x of b) expect(cuts(s, x)).toBe(false);
    });
});
