import { z } from 'zod';

import type { RenderContext } from './RenderContext';
import type { Settings } from './Settings';

// Widget item schema - accepts any string type for forward compatibility
export const WidgetItemSchema = z.object({
    id: z.string(),
    type: z.string(),
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    bold: z.boolean().optional(),
    dynamic: z.boolean().optional(),
    dim: z.union([z.boolean(), z.literal('parens')]).optional(),
    character: z.string().optional(),
    rawValue: z.boolean().optional(),
    customText: z.string().optional(),
    customSymbol: z.string().optional(),
    commandPath: z.string().optional(),
    maxWidth: z.number().optional(),
    preserveColors: z.boolean().optional(),
    timeout: z.number().optional(),
    merge: z.union([z.boolean(), z.literal('no-padding')]).optional(),
    hide: z.boolean().optional(),
    excludeFromAutoAlign: z.boolean().optional(),
    metadata: z.record(z.string(), z.string()).optional()
});

// Inferred types from Zod schemas
export type WidgetItem = z.infer<typeof WidgetItemSchema>;
export type WidgetItemType = string; // Allow any string for forward compatibility

export interface WidgetEditorDisplay {
    displayText: string;
    modifierText?: string;
}

export interface Widget {
    getDefaultColor(): string;
    getDescription(): string;
    getDisplayName(): string;
    getCategory(): string;
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay;
    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null;
    getCustomKeybinds?(item?: WidgetItem): CustomKeybind[];
    renderEditor?(props: WidgetEditorProps): React.ReactElement | null;
    supportsRawValue(): boolean;
    supportsColors(item: WidgetItem): boolean;
    handleEditorAction?(action: string, item: WidgetItem): WidgetItem | null;
    getNumericValue?(context: RenderContext, item: WidgetItem): number | null;

    // Fraction in [0, 1] representing how "full" this widget's metric is right now
    // (e.g. context used, session usage, elapsed reset window). Used to sample a
    // dynamic color ramp when the item has `dynamic` enabled. Return null when no
    // meaningful fill can be computed (e.g. missing data). Widgets without a
    // fillable metric omit this method.
    getFillRatio?(context: RenderContext, item: WidgetItem): number | null;
}

export interface WidgetEditorProps {
    widget: WidgetItem;
    onComplete: (updatedWidget: WidgetItem) => void;
    onCancel: () => void;
    action?: string;
}

export interface CustomKeybind {
    key: string;
    label: string;
    action: string;
}
