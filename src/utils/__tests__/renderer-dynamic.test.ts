import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

function createSettings(): Settings {
    return { ...DEFAULT_SETTINGS, flexMode: 'full', colorLevel: 3 };
}

function renderSessionUsage(sessionUsage: number): string {
    const widgets: WidgetItem[] = [
        { id: 'w1', type: 'session-usage', rawValue: true, color: 'dynamic:22c55e-ef4444' }
    ];
    const settings = createSettings();
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: 200,
        usageData: { sessionUsage }
    };
    const preRenderedLines = preRenderAllWidgets([widgets], settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    return renderStatusLine(widgets, settings, context, preRenderedLines[0] ?? [], preCalculatedMaxWidths);
}

function firstRgb(line: string): { r: number; g: number; b: number } | null {
    const m = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(line);
    return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
}

describe('renderer dynamic (value-based) colors', () => {
    it('colors a low session usage toward green', () => {
        const rgb = firstRgb(renderSessionUsage(5));
        if (!rgb) {
            throw new Error('expected a truecolor code');
        }
        // green ramp start (#22c55e): green channel dominates red
        expect(rgb.g).toBeGreaterThan(rgb.r);
    });

    it('colors a high session usage toward red', () => {
        const rgb = firstRgb(renderSessionUsage(95));
        if (!rgb) {
            throw new Error('expected a truecolor code');
        }
        // red ramp end (#ef4444): red channel dominates green
        expect(rgb.r).toBeGreaterThan(rgb.g);
    });

    it('produces different colors for low vs high usage', () => {
        const low = firstRgb(renderSessionUsage(10));
        const high = firstRgb(renderSessionUsage(90));
        expect(low).not.toEqual(high);
    });
});
