import {
  createModelFromHtml,
  EditPlugin,
  Editor,
  ShortcutPlugin,
  type ContentModelBlock,
} from "roosterjs";
import { container, fail, flaggedRuns, LINK, publish, seedHtml } from "./shared";

/**
 * RoosterJS, the editor of Outlook on the web. The editable has the markup of
 * the Outlook compose body. Rooster's own snapshot undo handles Ctrl/Cmd+Z
 * (ShortcutPlugin), and EditPlugin handles Tab, Enter and Backspace, as in Outlook.
 * The editor adds itself to `window.__ROOSTERJS_DEVTOOLS_EDITORS__` (roosterjs 9.59+).
 */
interface Paragraph {
  text: string;
  bold: boolean[];
  link: boolean[];
}

function paragraphs(blocks: ContentModelBlock[]): Paragraph[] {
  return blocks.flatMap((block): Paragraph[] => {
    if ("blocks" in block) return paragraphs(block.blocks);
    if (block.blockType !== "Paragraph") return [];
    const paragraph: Paragraph = { text: "", bold: [], link: [] };
    for (const segment of block.segments) {
      if (segment.segmentType !== "Text") continue;
      const weight = segment.format.fontWeight;
      const each = (flag: boolean) => Array<boolean>(segment.text.length).fill(flag);
      paragraph.bold.push(...each(weight === "bold" || weight === "700"));
      paragraph.link.push(...each(segment.link?.format.href === LINK));
      paragraph.text += segment.text;
    }
    return [paragraph];
  });
}

try {
  const editable = document.createElement("div");
  editable.id = "test-review-rooster";
  editable.setAttribute("contenteditable", "true");
  editable.setAttribute("role", "textbox");
  editable.setAttribute("data-ms-editor", "true");
  editable.style.minHeight = "120px";
  container().append(editable);
  const editor = new Editor(editable, {
    plugins: [new EditPlugin(), new ShortcutPlugin()],
    initialModel: createModelFromHtml(seedHtml()),
  });
  // The editor's own model, read again from its content.
  const model = () => paragraphs(editor.getContentModelCopy("clean").blocks);
  publish({
    frame: null,
    editable: "#test-review-rooster",
    text: () =>
      model()
        .map((paragraph) => paragraph.text)
        .join("\n"),
    runs() {
      const all = model();
      const text = all.map((paragraph) => paragraph.text).join("\n");
      const flags = (pick: (paragraph: Paragraph) => boolean[]) =>
        all.flatMap((paragraph) => [...pick(paragraph), false]);
      const bold = flags((paragraph) => paragraph.bold);
      const link = flags((paragraph) => paragraph.link);
      return {
        bold: flaggedRuns(text, (index) => bold[index]),
        links: flaggedRuns(text, (index) => link[index]),
      };
    },
  });
} catch (error) {
  fail(error);
}
