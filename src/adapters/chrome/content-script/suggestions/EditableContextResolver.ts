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
        afterCursor: snapshot.afterCursor,
        fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
        cursorOffset: snapshot.cursorOffset,
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
      afterCursor: blockContext?.afterCursor ?? snapshot.afterCursor,
      fullText: `${snapshot.beforeCursor}${snapshot.afterCursor}`,
      cursorOffset: snapshot.cursorOffset,
      selectionStable: !this.contentEditableAdapter.hasUnstableSelection(elem),
      blockContext: blockContext ?? null,
    };
  }
}
