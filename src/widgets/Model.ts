import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

export class ModelWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Displays the Claude model name (e.g., Claude 3.5 Sonnet)'; }
    getDisplayName(): string { return 'Model'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'Claude' : 'Model: Claude';
        }

        const model = context.data?.model;
        const modelDisplayName = typeof model === 'string'
            ? model
            : (model?.display_name ?? model?.id);

        if (modelDisplayName) {
            const shortName = modelDisplayName.replace(/\s*(?:\(.*\)|\[.*\])$/, '');
            const contextTag = this.getContextTag(model, modelDisplayName);
            const name = contextTag ? `${shortName} (${contextTag})` : shortName;
            return item.rawValue ? name : `Model: ${name}`;
        }
        return null;
    }

    // Extracts an extended-context marker (e.g. "1M") from the model id/name
    // so a 1M variant is distinguishable from the standard one. The bracketed
    // form like "[1m]" lives only in the id, while a "(1M context)" suffix may
    // appear in the display name and is stripped from shortName above.
    private getContextTag(model: string | { id?: string; display_name?: string } | undefined, displayName: string): string | null {
        const modelId = typeof model === 'string' ? model : model?.id;
        const source = `${modelId ?? ''} ${displayName}`;
        const match = /(?:\(|\[)\s*(\d+(?:[.,]\d+)?)\s*([km])\s*(?:\)|\])/i.exec(source);
        if (!match?.[1] || !match[2]) {
            return null;
        }
        return `${match[1]}${match[2].toUpperCase()}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
