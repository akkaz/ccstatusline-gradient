import {
    describe,
    expect,
    it
} from 'vitest';

import {
    parseDynamicSpec,
    resolveDynamicColor
} from '../gradient';

describe('parseDynamicSpec', () => {
    it('parses presets and custom stops under the dynamic: prefix', () => {
        expect(parseDynamicSpec('dynamic:retro')?.stops).toHaveLength(9);
        expect(parseDynamicSpec('dynamic:22c55e-eab308-ef4444')?.stops).toEqual(['#22c55e', '#eab308', '#ef4444']);
    });

    it('does not match the gradient: prefix and rejects invalid specs', () => {
        expect(parseDynamicSpec('gradient:retro')).toBeNull();
        expect(parseDynamicSpec('dynamic:')).toBeNull();
        expect(parseDynamicSpec('dynamic:nope')).toBeNull();
        expect(parseDynamicSpec(undefined)).toBeNull();
    });
});

describe('resolveDynamicColor', () => {
    const ramp = 'dynamic:22c55e-eab308-ef4444'; // green -> yellow -> red

    it('samples the first stop at ratio 0 and the last at ratio 1', () => {
        expect(resolveDynamicColor(ramp, 0)).toBe('hex:22c55e');
        expect(resolveDynamicColor(ramp, 1)).toBe('hex:ef4444');
    });

    it('samples the middle stop around ratio 0.5', () => {
        expect(resolveDynamicColor(ramp, 0.5)).toBe('hex:eab308');
    });

    it('clamps out-of-range ratios', () => {
        expect(resolveDynamicColor(ramp, -1)).toBe('hex:22c55e');
        expect(resolveDynamicColor(ramp, 5)).toBe('hex:ef4444');
    });

    it('returns undefined for non-dynamic or invalid colors', () => {
        expect(resolveDynamicColor('gradient:retro', 0.5)).toBeUndefined();
        expect(resolveDynamicColor('hex:ff0000', 0.5)).toBeUndefined();
        expect(resolveDynamicColor('dynamic:bad', 0.5)).toBeUndefined();
    });
});
