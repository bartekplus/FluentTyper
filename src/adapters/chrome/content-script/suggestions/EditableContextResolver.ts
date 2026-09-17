import { ContentEditableAdapter } from "./ContentEditableAdapter";
import { TextTargetAdapter } from "./TextTargetAdapter";
import type { SuggestionElement, EditableContext } from "./types";

export class EditableContextResolver {
  private readonly contentEditableAdapter = new ContentEditableAdapter();

  public resolve(elem: SuggestionElement): EditableContext | null {
    if (TextTargetAdapter.isTextValue(elem)) {
      const snapshot = TextTargetAdapter.snapshot(elem);

      return {
        kind: "text-value",
        beforeCursor: snapshot.beforeCursor,
        fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
        selectionStable: true,
      };
    }

    if (!elem.isContentEditable) {
      return null;
    }

    const snapshot = TextTargetAdapter.snapshot(elem);
    const blockContext = this.contentEditableAdapter.getBlockContext(elem);

    return {
      kind: "contenteditable",
      beforeCursor: blockContext?.beforeCursor ?? snapshot.beforeCursor,
      fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
      selectionStable: !this.contentEditableAdapter.hasUnstableSelection(elem),
    };
  }
}
