import type { ReviewApplyResult, ReviewTargetText } from "@core/application/review/ReviewSession";
import type { ReviewEdit, TextRange } from "@core/domain/grammar/review/types";
import {
  applyEdits,
  editTouches,
  isGraphemeBoundary,
} from "@core/domain/grammar/review/textRanges";
import {
  buildContentEditableTextMap,
  domPositionToOffset,
  offsetRangeToDomRange,
} from "../review/ContentEditableTextMap";
import { formattingPreservingEdits } from "../review/RichTextFormatting";
import { isHiddenField, isLockedField, isSensitiveField } from "./FieldEligibility";
import { gutenbergFields, isGutenbergField } from "./GutenbergEnvironment";
import type { HostEditorApplyResult, HostEditorSession } from "./HostEditorAdapterResolver";

type Attributes = Record<string, unknown>;
interface Block {
  clientId: string;
  name: string;
  attributes: Attributes;
  innerBlocks?: Block[];
}
interface AttributeSchema {
  type?: string;
  source?: string;
  query?: Record<string, AttributeSchema>;
}
interface BlockSelectors {
  getBlock(id: string): Block | null;
  getBlockRootClientId?(id: string): string | null;
  getBlockIndex?(id: string, root?: string): number;
  getMultiSelectedBlockClientIds?(): string[];
  getBlockParents?(id: string): string[];
  getClientIdsWithDescendants?(): string[];
  areInnerBlocksControlled?(id: string): boolean;
  getBlockEditingMode?(id: string): string;
  canEditBlock?(id: string): boolean;
}
interface BlockActions {
  updateBlockAttributes(
    ids: string[],
    attributes: Record<string, Attributes>,
    options: { uniqueByBlock: true },
  ): void;
  selectionChange?(selection: {
    selectionStart: NativeSelection;
    selectionEnd: NativeSelection;
  }): void;
  __unstableMarkLastChangeAsPersistent?(): void;
  __unstableMarkNextChangeAsNotPersistent?(): void;
}
interface NativeSelection {
  clientId: string;
  attributeKey: string;
  offset: number;
}
interface NativeUndoManager {
  addRecord: (record?: { id: unknown; changes: unknown }[], staged?: boolean) => void;
  hasUndo(): boolean;
  hasRedo(): boolean;
}
interface Registry {
  stores?: {
    core?: {
      store?: {
        getState(): {
          undoManager?: NativeUndoManager;
          syncConnectionStatuses?: Record<string, unknown>;
        };
      };
    };
  };
  RegistryConsumer?: { _context?: { _currentValue?: Registry } };
  select(store: "core"): {
    getUndoManager?(): NativeUndoManager;
    hasUndo?(): boolean;
    hasRedo?(): boolean;
    getEditedEntityRecord?(
      kind: string,
      name: string,
      id?: number | string,
    ): Attributes | undefined;
    canUser?(
      action: string,
      resource: { kind: string; name: string; id?: number },
    ): boolean | undefined;
  };
  dispatch(store: "core"): {
    __unstableCreateUndoLevel?(): void;
    editEntityRecord?(
      kind: string,
      name: string,
      id: number | string | undefined,
      edits: Attributes,
      options?: { isCached?: boolean; undoIgnore?: boolean },
    ): void;
  };
  select(store: "core/block-editor"): BlockSelectors;
  select(store: "core/editor"): {
    getEditedPostAttribute(name: string): unknown;
    getCurrentPostId?(): number;
    getCurrentPostType?(): string;
  };
  dispatch(store: "core/block-editor"): BlockActions;
  dispatch(store: "core/editor"): {
    editPost(attributes: Attributes, options?: { isCached: boolean }): void;
  };
  batch(callback: () => void): void;
}
interface RichValue {
  text: string;
  formats: unknown[][];
  replacements?: unknown[];
  start?: number;
  end?: number;
}
interface RichTextApi {
  create(args: { html: string }): RichValue;
  insert(value: RichValue, insert: RichValue, start: number, end: number): RichValue;
  toHTMLString(args: { value: RichValue; preserveWhiteSpace: true }): string;
  RichTextData?: {
    new (...args: never[]): { toHTMLString(): string };
    fromHTMLString(html: string): { toHTMLString(): string };
  };
}
interface Fiber {
  return?: Fiber | null;
  alternate?: Fiber | null;
  memoizedProps?: Record<string, unknown>;
}
type WPWindow = Window & {
  wp?: {
    data?: Registry;
    richText?: RichTextApi;
    element?: { flushSync(callback: () => void): void };
    blocks?: {
      serialize(blocks: Block[]): string;
      getBlockType?(name: string): { attributes?: Record<string, AttributeSchema> } | undefined;
      __unstableSerializeAndClean?(blocks: Block[]): string;
    };
  };
};
interface Field {
  element: HTMLElement;
  registry: Registry;
  api: RichTextApi;
  block: Block | null;
  path: string;
  html: string;
  value: unknown;
  text: string;
  entity: unknown;
  position: unknown;
  titleEntity?: { name: string; id: number };
  siteProperty?: "title" | "description";
  plainTitle: boolean;
  start: number;
  end: number;
  map: ReturnType<typeof buildContentEditableTextMap>;
}
export interface GutenbergSnapshot extends ReviewTargetText {
  fields: { index: number; start: number; end: number }[];
  scope: TextRange | null;
}
export type GutenbergApplyRequest = {
  edits: ReviewEdit[];
  before: string;
  after: string;
  signature: string;
};

const identities = new WeakMap<object, number>();
const composing = new WeakSet<HTMLElement>();
export function setGutenbergComposing(element: HTMLElement, active: boolean): void {
  if (active) composing.add(element);
  else composing.delete(element);
}
let nextIdentity = 1;
function identity(value: object): number {
  let id = identities.get(value);
  if (!id) {
    id = nextIdentity++;
    identities.set(value, id);
  }
  return id;
}
function registry(value: unknown): value is Registry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Registry>;
  return (
    typeof candidate.select === "function" &&
    typeof candidate.dispatch === "function" &&
    typeof candidate.batch === "function"
  );
}
function owningApi(
  element: HTMLElement,
  nativeValue?: unknown,
): {
  data: Registry;
  richText: RichTextApi;
  flushSync?: (callback: () => void) => void;
  serialize?: (blocks: Block[]) => string;
  schemas?: (name: string) => Record<string, AttributeSchema> | undefined;
} | null {
  let win = element.ownerDocument.defaultView as WPWindow | null;
  for (let depth = 0; win && depth < 8; depth++) {
    try {
      const wp = win.wp;
      if (
        typeof wp?.data?.select === "function" &&
        typeof wp.data.dispatch === "function" &&
        typeof wp?.richText?.create === "function" &&
        typeof wp.richText.insert === "function" &&
        typeof wp.richText.toHTMLString === "function" &&
        (nativeValue === undefined ||
          typeof nativeValue === "string" ||
          (typeof wp.richText.RichTextData === "function" &&
            nativeValue instanceof wp.richText.RichTextData))
      )
        return {
          data: wp.data,
          richText: wp.richText,
          flushSync: wp.element?.flushSync.bind(wp.element),
          schemas: (name) => wp.blocks?.getBlockType?.(name)?.attributes,
          serialize: wp.blocks
            ? (blocks) =>
                wp.blocks!.__unstableSerializeAndClean
                  ? wp.blocks!.__unstableSerializeAndClean(blocks)
                  : wp.blocks!.serialize(blocks)
            : undefined,
        };
      if (win.parent === win) break;
      win = win.parent;
    } catch {
      break;
    }
  }
  return null;
}

/** Read the native provider's registry value or BlockEditorProvider registry
 * prop. Do not read hook state or callback closures. Verify native block identity. */
function owningRegistry(element: HTMLElement, fallback: Registry): Registry | null {
  let fiber: Fiber | undefined;
  for (let node: HTMLElement | null = element; node && !fiber; node = node.parentElement) {
    const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactFiber$"));
    if (key) fiber = (node as unknown as Record<string, Fiber>)[key];
  }
  const owns = (value: unknown): value is Registry => {
    if (!registry(value)) return false;
    try {
      const id = element.closest("[data-block]")?.getAttribute("data-block");
      return id
        ? value.select("core/block-editor")?.getBlock(id)?.clientId === id
        : element.matches(".editor-post-title__input") &&
            typeof value.select("core/editor")?.getEditedPostAttribute === "function";
    } catch {
      return false;
    }
  };
  for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return ?? undefined) {
    if (owns(fiber.memoizedProps?.value)) return fiber.memoizedProps.value;
    if (owns(fiber.memoizedProps?.registry)) return fiber.memoizedProps.registry;
  }
  if (owns(fallback)) return fallback;
  const provider = (
    fallback as unknown as {
      RegistryProvider?: { _currentValue?: unknown; _context?: { _currentValue?: unknown } };
    }
  ).RegistryProvider;
  const value = provider?._currentValue ?? provider?._context?._currentValue;
  return owns(value) ? value : null;
}

function titleContext(element: HTMLElement): { name: string; id: number } | null {
  const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
  for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return ?? undefined) {
    const value = fiber.memoizedProps?.value as
      { postType?: unknown; postId?: unknown } | undefined;
    if (
      typeof value?.postType === "string" &&
      Number.isSafeInteger(value.postId) &&
      Number(value.postId) > 0
    )
      return { name: value.postType, id: Number(value.postId) };
  }
  return null;
}
function entityTitle(data: Registry, entity: { name: string; id: number }): string | null {
  const value = data
    .select("core")
    ?.getEditedEntityRecord?.("postType", entity.name, entity.id)?.title;
  if (typeof value === "string") return value;
  return value && typeof value === "object" && typeof (value as Attributes).raw === "string"
    ? (value as { raw: string }).raw
    : null;
}
function textHtml(element: HTMLElement, value: string): string {
  const span = element.ownerDocument.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}
function pathParts(path: string): string[] | null {
  const parts = path.split(".");
  return parts.length <= 12 &&
    parts.every(
      (part) =>
        /^[a-zA-Z0-9_-]+$/.test(part) && !["__proto__", "prototype", "constructor"].includes(part),
    )
    ? parts
    : null;
}
function atPath(value: unknown, parts: string[]): unknown {
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Attributes)[part];
  }
  return current;
}
function setPath(value: Attributes, parts: string[], replacement: unknown): Attributes {
  const [key, ...rest] = parts;
  const next = Array.isArray(value) ? ([...value] as unknown as Attributes) : { ...value };
  next[key] = rest.length ? setPath(value[key] as Attributes, rest, replacement) : replacement;
  return next;
}
function valueHtml(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toHTMLString?: unknown }).toHTMLString === "function"
  )
    return (value as { toHTMLString(): string }).toHTMLString();
  return null;
}
function blockEntity(data: Registry, block: Block): unknown[] | null {
  const selectors = data.select("core/block-editor");
  let current = selectors.getBlockRootClientId?.(block.clientId);
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return null;
    visited.add(current);
    const parent = selectors.getBlock(current);
    if (!parent) return null;
    if (selectors.areInnerBlocksControlled?.(current)) {
      if (parent.name === "core/template-part") {
        const { theme, slug } = parent.attributes;
        if (typeof theme !== "string" || typeof slug !== "string" || !theme || !slug) return null;
        return ["postType", "wp_template_part", `${theme}//${slug}`];
      }
      const name =
        parent.name === "core/block"
          ? "wp_block"
          : parent.name === "core/navigation"
            ? "wp_navigation"
            : null;
      const id = parent.attributes.ref;
      if (!name || !Number.isSafeInteger(id) || Number(id) <= 0) return null;
      return ["postType", name, id];
    }
    current = selectors.getBlockRootClientId?.(current);
  }
  const post = data.select("core/editor");
  return ["postType", post?.getCurrentPostType?.(), post?.getCurrentPostId?.()];
}
function fieldFor(element: HTMLElement): Field | null {
  if (
    !element.isConnected ||
    composing.has(element) ||
    !isGutenbergField(element) ||
    isLockedField(element) ||
    isSensitiveField(element) ||
    isHiddenField(element)
  )
    return null;
  const wp = owningApi(element);
  if (!wp) return null;
  const data = owningRegistry(element, wp.data);
  if (!data) return null;
  const blockId = element.closest("[data-block]")?.getAttribute("data-block");
  const title = element.matches(".editor-post-title__input");
  const block = blockId ? data.select("core/block-editor").getBlock(blockId) : null;
  const titleEntity = block?.name === "core/post-title" ? titleContext(element) : null;
  const siteProperty =
    block?.name === "core/site-title"
      ? "title"
      : block?.name === "core/site-tagline"
        ? "description"
        : undefined;
  const plainTitle = title || !!titleEntity;
  const path =
    siteProperty ?? (plainTitle ? "title" : element.getAttribute("data-wp-block-attribute-key"));
  if (!path || !pathParts(path)) return null;
  if (block?.name === "core/post-title" && !titleEntity) return null;
  if (
    titleEntity &&
    data.select("core")?.canUser?.("update", { kind: "postType", ...titleEntity }) !== true
  )
    return null;
  if (
    siteProperty &&
    data.select("core")?.canUser?.("update", { kind: "root", name: "site" }) !== true
  )
    return null;
  if (!title && (!block || block.clientId !== blockId)) return null;
  if (block) {
    const selectors = data.select("core/block-editor");
    if (
      selectors.canEditBlock?.(block.clientId) === false ||
      selectors.getBlockEditingMode?.(block.clientId) === "disabled" ||
      (block.attributes.metadata &&
        (block.attributes.metadata as Attributes).bindings &&
        Object.hasOwn((block.attributes.metadata as { bindings: Attributes }).bindings, path))
    )
      return null;
  }
  const value = siteProperty
    ? data.select("core")?.getEditedEntityRecord?.("root", "site")?.[siteProperty]
    : titleEntity
      ? entityTitle(data, titleEntity)
      : title
        ? data.select("core/editor").getEditedPostAttribute("title")
        : atPath(block!.attributes, pathParts(path)!);
  const html =
    plainTitle && typeof value === "string" ? textHtml(element, value) : valueHtml(value);
  if (html === null) return null;
  // A blob canvas can load a second Gutenberg bundle. RichText rejects values
  // from another bundle even when their serialized HTML is the same.
  const valueApi = owningApi(element, value);
  if (!valueApi) return null;
  const map = buildContentEditableTextMap(element);
  const record = valueApi.richText.create({ html });
  // Gutenberg uses a protected zero-width filler in empty RichText fields.
  if (!record.text && /^[\uFEFF\u200B]*$/.test(map.text)) {
    map.text = "";
    map.protectedRanges = [];
  }
  if (record.text !== map.text) return null;
  const post = data.select("core/editor");
  const entity = siteProperty
    ? ["root", "site", siteProperty]
    : titleEntity
      ? ["postType", titleEntity.name, titleEntity.id]
      : block
        ? blockEntity(data, block)
        : ["postType", post?.getCurrentPostType?.(), post?.getCurrentPostId?.()];
  if (!entity) return null;
  return {
    element,
    registry: data,
    api: valueApi.richText,
    block,
    path,
    html,
    value,
    text: map.text,
    entity,
    position: block
      ? [
          data.select("core/block-editor").getBlockRootClientId?.(block.clientId),
          data.select("core/block-editor").getBlockIndex?.(block.clientId),
        ]
      : null,
    plainTitle,
    ...(titleEntity ? { titleEntity } : {}),
    ...(siteProperty ? { siteProperty } : {}),
    start: 0,
    end: map.text.length,
    map,
  };
}

/** Count native prose that has no verified rendered binding. Do not load entities. */
function missingProse(
  values: Attributes,
  schemas: Record<string, AttributeSchema>,
  represented: Set<string>,
  api: RichTextApi,
  prefix = "",
  depth = 0,
): number {
  if (depth > 12) return 1;
  let unread = 0;
  for (const [key, schema] of Object.entries(schemas)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = values[key];
    if (schema.source === "query" && schema.query && Array.isArray(value)) {
      for (const [index, row] of value.entries())
        if (row && typeof row === "object")
          unread += missingProse(
            row as Attributes,
            schema.query,
            represented,
            api,
            `${path}.${index}`,
            depth + 1,
          );
    } else if (
      !represented.has(path) &&
      (schema.type === "rich-text" || schema.source === "rich-text" || schema.source === "html")
    ) {
      const html = valueHtml(value);
      if (html) unread += api.create({ html }).text.length;
    }
  }
  return unread;
}

/** Some WordPress builds keep the manager in the native Redux store. Use that
 * manager only for the exact owning core store with collaboration disabled. */
function nativeUndoManager(data: Registry, source: HTMLElement): NativeUndoManager | null {
  let win: Window | null = source.ownerDocument.defaultView;
  for (let depth = 0; win && depth < 8; depth++) {
    try {
      if ((win as Window & { _wpCollaborationEnabled?: boolean })._wpCollaborationEnabled)
        return null;
      if (win.parent === win) break;
      win = win.parent;
    } catch {
      return null;
    }
  }
  const selectors = data.select("core");
  const selected = selectors?.getUndoManager?.();
  if (
    selected &&
    typeof selected.addRecord === "function" &&
    typeof (selected as NativeUndoManager & { stopCapturing?: unknown }).stopCapturing !==
      "function"
  )
    return selected;
  const fallback = owningApi(source)?.data.RegistryConsumer?._context?._currentValue;
  const owner = data.stores?.core ? data : fallback;
  if (!owner || owner.select("core") !== selectors) return null;
  const state = owner.stores?.core?.store?.getState();
  const manager = state?.undoManager;
  return state?.syncConnectionStatuses &&
    !Object.keys(state.syncConnectionStatuses).length &&
    manager &&
    typeof manager.addRecord === "function" &&
    manager.hasUndo() === selectors.hasUndo?.() &&
    manager.hasRedo() === selectors.hasRedo?.()
    ? manager
    : null;
}

/** Stage later records for this action's entities in its first native level.
 * Restore the native method before returning. Do not collect unrelated edits. */
function groupHistory(manager: NativeUndoManager, entities: unknown[][]): () => boolean {
  const keys = new Set(
    entities.map(([kind, name, recordId]) => JSON.stringify({ kind, name, recordId })),
  );
  const original = manager.addRecord;
  let started = false;
  let unexpected = false;
  let finished = false;
  const grouped: NativeUndoManager["addRecord"] = (record, staged) => {
    if (record?.length) {
      const belongs = record.every(({ id }) => {
        if (!id || typeof id !== "object") return false;
        const value = id as Attributes;
        return keys.has(
          JSON.stringify({ kind: value.kind, name: value.name, recordId: value.recordId }),
        );
      });
      if (!belongs) unexpected = true;
      else if (started) staged = true;
      else if (!staged) started = true;
    }
    original.call(manager, record, staged);
  };
  manager.addRecord = grouped;
  return () => {
    if (!finished) {
      finished = true;
      if (manager.addRecord !== grouped) unexpected = true;
      else manager.addRecord = original;
    }
    return started && !unexpected;
  };
}

function snapshot(
  source: HTMLElement,
  whole: boolean,
  captureSelection = false,
): { value: GutenbergSnapshot; fields: Field[] } | null {
  const sourceField = fieldFor(source);
  if (!sourceField) return null;
  const elements = whole ? gutenbergFields(source) : [source];
  const candidates = elements.map((element, index) => ({
    element,
    index,
    field: fieldFor(element),
  }));
  const trees = new Map<Registry, string[]>();
  if (whole) {
    for (const { field } of candidates) {
      if (field && !trees.has(field.registry)) {
        const ids = field.registry.select("core/block-editor").getClientIdsWithDescendants?.();
        if (ids) trees.set(field.registry, ids);
      }
    }
    // Keep each DOM ordinal for highlights, but use native block order for offsets.
    for (const [data, ids] of trees) {
      const ranks = new Map(ids.map((id, index) => [id, index]));
      const slots = candidates.flatMap((candidate, index) =>
        candidate.field?.registry === data ? [index] : [],
      );
      const ordered = slots
        .map((index) => candidates[index])
        .sort((a, b) => {
          const rankA = a.field!.block ? ranks.get(a.field!.block.clientId) : -1;
          const rankB = b.field!.block ? ranks.get(b.field!.block.clientId) : -1;
          return rankA === undefined || rankB === undefined
            ? a.index - b.index
            : rankA - rankB || a.index - b.index;
        });
      slots.forEach((slot, index) => {
        candidates[slot] = ordered[index];
      });
    }
  }
  const fields: Field[] = [];
  const protectedRanges: GutenbergSnapshot["protectedRanges"] = [];
  const signature: unknown[] = [];
  const exposed: GutenbergSnapshot["fields"] = [];
  let text = "";
  let unread = 0;
  for (const [ordinal, candidate] of candidates.entries()) {
    const { index, element, field } = candidate;
    if (text.length + (field?.text.length ?? 1) + (ordinal ? 1 : 0) > 200_000) {
      unread += Math.max(1, field?.text.length ?? element.textContent?.length ?? 0);
      signature.push([identity(element), "outside-window", field?.html, field?.block?.attributes]);
      continue;
    }
    if (ordinal) {
      protectedRanges.push({ start: text.length, end: text.length + 1, reason: "structure" });
      text += "\n";
    }
    if (!field) {
      protectedRanges.push({ start: text.length, end: text.length + 1, reason: "structure" });
      text += "\uFFFC";
      unread += Math.max(1, element.textContent?.length ?? 0);
      signature.push([
        identity(element),
        "unsupported",
        element.getAttribute("contenteditable"),
        element.getAttribute("aria-readonly"),
      ]);
      continue;
    }
    field.start = text.length;
    text += field.text;
    field.end = text.length;
    fields.push(field);
    exposed.push({ index, start: field.start, end: field.end });
    protectedRanges.push(
      ...field.map.protectedRanges.map((range) => ({
        ...range,
        start: range.start + field.start,
        end: range.end + field.start,
      })),
    );
    signature.push([
      identity(element),
      identity(field.registry),
      field.block?.clientId ?? "title",
      field.path,
      field.entity,
      field.position,
      field.html,
      field.block?.attributes,
      field.map.signature,
    ]);
  }
  if (whole) {
    const wp = owningApi(source, sourceField.value)!;
    const representedFields = new Map<Registry, Map<string, Set<string>>>();
    for (const { field, element } of candidates) {
      const data = field?.registry ?? owningRegistry(element, wp.data);
      const id =
        field?.block?.clientId ?? element.closest("[data-block]")?.getAttribute("data-block");
      if (!data || !id) continue;
      let blocks = representedFields.get(data);
      if (!blocks) representedFields.set(data, (blocks = new Map<string, Set<string>>()));
      let paths = blocks.get(id);
      if (!paths) blocks.set(id, (paths = new Set()));
      paths.add(field?.path ?? element.getAttribute("data-wp-block-attribute-key") ?? "");
    }
    for (const [data, ids] of trees) {
      const selectors = data.select("core/block-editor");
      const native = ids.map((id) => [
        id,
        selectors.getBlock(id),
        selectors.getBlockEditingMode?.(id),
      ]);
      signature.push([identity(data), native]);
      for (const id of ids) {
        const block = selectors.getBlock(id);
        if (!block) {
          unread++;
          continue;
        }
        const represented = representedFields.get(data)?.get(id) ?? new Set<string>();
        const schemas = wp.schemas?.(block.name);
        if (schemas) unread += missingProse(block.attributes, schemas, represented, wp.richText);
        else if (
          !represented.size &&
          Object.values(block.attributes).some((value) => typeof value === "string" && value.length)
        )
          unread++;
      }
    }
  }
  const selection = source.ownerDocument.getSelection();
  let scope: TextRange | null = null;
  if (captureSelection && selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const endpoint = (node: Node, offset: number) => {
      const field = fields.find((candidate) => candidate.element.contains(node));
      const local = field ? domPositionToOffset(field.map, node, offset) : null;
      return field && local !== null ? field.start + local : null;
    };
    const start = endpoint(range.startContainer, range.startOffset);
    const end = endpoint(range.endContainer, range.endOffset);
    if (start !== null && end !== null && end > start) scope = { start, end };
    else if (start !== null || end !== null) return null;
  }
  if (captureSelection && !scope && selection?.isCollapsed) {
    const selectionRegistry = fieldFor(source)!.registry;
    const selectors = selectionRegistry.select("core/block-editor");
    const selected = selectors.getMultiSelectedBlockClientIds?.() ?? [];
    if (selected.length) {
      const belongs = (field: Field, id: string): boolean =>
        field.registry === selectionRegistry &&
        !!field.block &&
        (field.block.clientId === id ||
          (selectors.getBlockParents?.(field.block.clientId) ?? []).includes(id));
      const parts = fields.filter((field) => selected.some((id) => belongs(field, id)));
      if (!parts.length || selected.some((id) => !parts.some((field) => belongs(field, id))))
        return null;
      scope = { start: parts[0].start, end: parts.at(-1)!.end };
    }
  }
  return {
    value: {
      text,
      protectedRanges,
      signature: JSON.stringify(signature),
      unread,
      fields: exposed,
      scope,
    },
    fields,
  };
}
export function readGutenberg(
  source: HTMLElement,
  captureSelection = false,
): GutenbergSnapshot | null {
  try {
    return snapshot(source, true, captureSelection)?.value ?? null;
  } catch {
    return null;
  }
}

function apply(
  source: HTMLElement,
  request: GutenbergApplyRequest,
  whole: boolean,
  cursorAfter?: number,
): ReviewApplyResult {
  const rejected: ReviewApplyResult = { status: "rejected", reason: "host-refused" };
  let dispatched = false;
  let finishHistory: (() => boolean) | null = null;
  try {
    const before = snapshot(source, whole);
    if (!before || !request.edits.length) return rejected;
    if (before.value.text !== request.before || before.value.signature !== request.signature)
      return { status: "stale" };
    if (
      applyEdits(request.before, request.edits) !== request.after ||
      request.edits.some(
        (edit) =>
          !isGraphemeBoundary(request.before, edit.start) ||
          !isGraphemeBoundary(request.before, edit.end) ||
          before.value.protectedRanges.some((range) => editTouches(edit, range)),
      )
    )
      return rejected;
    const groups = new Map<
      Registry,
      {
        actions: BlockActions;
        patches: Record<string, Attributes>;
        title?: string;
        entityEdits: { kind: string; name: string; id?: number; edits: Attributes }[];
      }
    >();
    const expectedHtml = new Map<Field, string>();
    let mappedEdits = 0;
    for (const field of before.fields) {
      const edits = request.edits
        .filter((edit) => edit.start >= field.start && edit.end <= field.end)
        .map((edit) => ({ ...edit, start: edit.start - field.start, end: edit.end - field.start }));
      if (!edits.length) continue;
      mappedEdits += edits.length;
      let group = groups.get(field.registry);
      if (!group) {
        const actions = field.registry.dispatch("core/block-editor");
        if (
          typeof actions.updateBlockAttributes !== "function" ||
          typeof actions.__unstableMarkLastChangeAsPersistent !== "function"
        )
          return rejected;
        group = { actions, patches: {}, entityEdits: [] };
        groups.set(field.registry, group);
      }
      const planned = formattingPreservingEdits(field.map, edits);
      if (!planned) return rejected;
      let record = field.api.create({ html: field.html });
      for (const edit of [...planned].sort((a, b) => b.start - a.start)) {
        const inserted: RichValue = {
          text: edit.replacement,
          formats: Array.from(
            { length: edit.replacement.length },
            () => record.formats[edit.start] ?? record.formats[edit.start - 1] ?? [],
          ),
          replacements: Array(edit.replacement.length),
        };
        record = field.api.insert(record, inserted, edit.start, edit.end);
      }
      const html = field.api.toHTMLString({ value: record, preserveWhiteSpace: true });
      expectedHtml.set(field, html);
      if (record.text !== applyEdits(field.text, edits)) return rejected;
      if (field.titleEntity || field.siteProperty) {
        if (
          /\r|\n/.test(record.text) ||
          typeof field.registry.dispatch("core")?.editEntityRecord !== "function"
        )
          return rejected;
        group.entityEdits.push(
          field.titleEntity
            ? { kind: "postType", ...field.titleEntity, edits: { title: record.text } }
            : { kind: "root", name: "site", edits: { [field.siteProperty!]: html } },
        );
      } else if (field.block) {
        const id = field.block.clientId;
        // Merge all cell changes before dispatch. Cell callbacks can close over stale rows.
        const value =
          typeof field.value === "string" ? html : field.api.RichTextData?.fromHTMLString(html);
        if (value === undefined) return rejected;
        group.patches[id] = setPath(
          group.patches[id] ?? field.block.attributes,
          pathParts(field.path)!,
          value,
        );
      } else {
        if (
          /\r|\n/.test(record.text) ||
          typeof field.registry.dispatch("core/editor").editPost !== "function"
        )
          return rejected;
        group.title = record.text;
      }
    }
    if (mappedEdits !== request.edits.length) return rejected;
    // One native value can appear in several loaded fields. Do not mutate an
    // alias unless every rendered copy has the same planned value.
    const bindings = new Map<string, string>();
    for (const field of before.fields) {
      const key = JSON.stringify(
        field.siteProperty
          ? ["root", "site", field.siteProperty]
          : field.titleEntity
            ? ["postType", field.titleEntity.name, field.titleEntity.id, "title"]
            : [identity(field.registry), field.block?.clientId ?? "post-title", field.path],
      );
      const html =
        expectedHtml.get(field) ??
        field.api.toHTMLString({
          value: field.api.create({ html: field.html }),
          preserveWhiteSpace: true,
        });
      if (bindings.has(key) && bindings.get(key) !== html) return rejected;
      bindings.set(key, html);
    }
    const check = snapshot(source, whole);
    if (
      !check ||
      check.value.signature !== request.signature ||
      check.value.text !== request.before
    )
      return { status: "stale" };
    const chunks: {
      data: Registry;
      actions: BlockActions;
      patches: Record<string, Attributes>;
      entity: unknown[];
    }[] = [];
    for (const [data, group] of groups) {
      const entities = new Map<string, Record<string, Attributes>>();
      for (const [id, patch] of Object.entries(group.patches)) {
        const field = before.fields.find(
          (candidate) => candidate.registry === data && candidate.block?.clientId === id,
        )!;
        const key = JSON.stringify(field.entity);
        const patches = entities.get(key) ?? {};
        patches[id] = patch;
        entities.set(key, patches);
      }
      for (const [key, patches] of entities)
        chunks.push({
          data,
          actions: group.actions,
          patches,
          entity: JSON.parse(key) as unknown[],
        });
    }
    if (
      chunks.length > 1 &&
      chunks.some(
        ({ data, actions }) =>
          typeof actions.__unstableMarkNextChangeAsNotPersistent !== "function" ||
          typeof data.dispatch("core").__unstableCreateUndoLevel !== "function",
      )
    )
      return rejected;
    const nativeApi = owningApi(
      source,
      before.fields.find((field) => field.element === source)?.value,
    );
    const serialize = nativeApi?.serialize;
    if (
      chunks.length > 1 &&
      (!serialize ||
        chunks.some(
          ({ data, entity }) =>
            entity[0] !== "postType" ||
            typeof entity[1] !== "string" ||
            !(typeof entity[2] === "string" || typeof entity[2] === "number") ||
            !data.select("core").getEditedEntityRecord?.(entity[0], entity[1], entity[2]) ||
            typeof data.dispatch("core").editEntityRecord !== "function",
        ))
    )
      return rejected;
    const managers = [...groups.keys()].map((data) => nativeUndoManager(data, source));
    const needsGroupedHistory = chunks.length > 1 || groups.size > 1;
    if (
      needsGroupedHistory &&
      (!managers[0] || managers.some((manager) => manager !== managers[0]))
    )
      return rejected;
    const flush = nativeApi?.flushSync;
    const sync = (callback: () => void) => (flush ? flush(callback) : callback());
    sync(() => {
      for (const group of groups.values()) group.actions.__unstableMarkLastChangeAsPersistent!();
    });
    if (needsGroupedHistory)
      finishHistory = groupHistory(managers[0]!, [
        ...chunks.map((chunk) => chunk.entity),
        ...[...groups.values()].flatMap((group) =>
          group.entityEdits.map((entity) => [entity.kind, entity.name, entity.id]),
        ),
      ]);
    // Validate the complete plan above, then create one persistent entity edit.
    // Later entity updates use Gutenberg's transient path and join that level.
    for (const [index, chunk] of chunks.entries()) {
      sync(() =>
        chunk.data.batch(() => {
          dispatched = true;
          if (cursorAfter !== undefined) {
            const field = before.fields.find(
              (candidate) => candidate.element === source && candidate.registry === chunk.data,
            );
            if (field?.block && chunk.actions.selectionChange) {
              const point = {
                clientId: field.block.clientId,
                attributeKey: field.path,
                offset: cursorAfter,
              };
              chunk.actions.selectionChange({ selectionStart: point, selectionEnd: point });
            }
          }
          if (index) chunk.actions.__unstableMarkNextChangeAsNotPersistent!();
          chunk.actions.updateBlockAttributes(Object.keys(chunk.patches), chunk.patches, {
            uniqueByBlock: true,
          });
          if (!index) chunk.actions.__unstableMarkLastChangeAsPersistent!();
        }),
      );
    }
    // Block synchronization creates the action's native history level. Cached
    // entity edits join that level after the block subscriptions have run.
    let hasHistoryLevel = [...groups.values()].some(
      (group) => Object.keys(group.patches).length > 0,
    );
    for (const [data, group] of groups) {
      if (group.title !== undefined) {
        dispatched = true;
        data
          .dispatch("core/editor")
          .editPost({ title: group.title }, { isCached: hasHistoryLevel });
        hasHistoryLevel = true;
      }
      for (const entity of group.entityEdits) {
        dispatched = true;
        data.dispatch("core").editEntityRecord!(entity.kind, entity.name, entity.id, entity.edits, {
          isCached: hasHistoryLevel,
        });
        hasHistoryLevel = true;
      }
    }
    if (chunks.length > 1) {
      if (
        chunks.some(
          ({ data, entity }) =>
            !Array.isArray(
              data
                .select("core")
                .getEditedEntityRecord?.(
                  "postType",
                  entity[1] as string,
                  entity[2] as number | string,
                )?.blocks,
            ),
        )
      )
        return { status: "unverified" };
      sync(() => {
        chunks[0].data.dispatch("core").__unstableCreateUndoLevel!();
        // Serialize each native entity and stage its content in the same
        // history level. Undo must restore content when transient blocks vanish.
        for (const { data, entity } of chunks) {
          const blocks = data.select("core").getEditedEntityRecord!(
            "postType",
            entity[1] as string,
            entity[2] as number | string,
          )!.blocks as Block[];
          data.dispatch("core").editEntityRecord!(
            "postType",
            entity[1] as string,
            entity[2] as number | string,
            { content: serialize!(blocks) },
            { isCached: true },
          );
        }
        chunks[0].data.dispatch("core").__unstableCreateUndoLevel!();
      });
    }
    if (finishHistory) {
      // Close RichText's transient changes now. Its one-second persistence timer
      // must not add a second level for a loaded template part's copied blocks.
      sync(() => {
        for (const group of groups.values()) group.actions.__unstableMarkLastChangeAsPersistent!();
      });
      chunks[0]?.data.dispatch("core").__unstableCreateUndoLevel?.();
      if (!finishHistory()) return { status: "unverified" };
    }
    // Native values are authoritative. React reconciles the rendered fields later.
    for (const field of before.fields) {
      const value = field.siteProperty
        ? field.registry.select("core")?.getEditedEntityRecord?.("root", "site")?.[
            field.siteProperty
          ]
        : field.titleEntity
          ? entityTitle(field.registry, field.titleEntity)
          : field.block
            ? atPath(
                field.registry.select("core/block-editor").getBlock(field.block.clientId)
                  ?.attributes,
                pathParts(field.path)!,
              )
            : field.registry.select("core/editor").getEditedPostAttribute("title");
      const html =
        field.plainTitle && typeof value === "string"
          ? textHtml(field.element, value)
          : valueHtml(value);
      const edits = request.edits
        .filter((edit) => edit.start >= field.start && edit.end <= field.end)
        .map((edit) => ({ ...edit, start: edit.start - field.start, end: edit.end - field.start }));
      if (html === null || field.api.create({ html }).text !== applyEdits(field.text, edits))
        return { status: "unverified" };
      const canonical = field.api.toHTMLString({
        value: field.api.create({ html }),
        preserveWhiteSpace: true,
      });
      const expected =
        expectedHtml.get(field) ??
        field.api.toHTMLString({
          value: field.api.create({ html: field.html }),
          preserveWhiteSpace: true,
        });
      if (canonical !== expected) return { status: "unverified" };
    }
    if (cursorAfter !== undefined) {
      const field = fieldFor(source);
      if (!field || field.text !== request.after) return { status: "unverified" };
      const range = offsetRangeToDomRange(
        field.map,
        { start: cursorAfter, end: cursorAfter },
        source.ownerDocument,
      );
      const selection = source.ownerDocument.getSelection();
      if (!range || !selection) return { status: "unverified" };
      source.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return { status: "applied" };
  } catch {
    return dispatched ? { status: "unverified" } : rejected;
  } finally {
    finishHistory?.();
  }
}
export function applyGutenberg(
  source: HTMLElement,
  request: GutenbergApplyRequest,
): ReviewApplyResult {
  return apply(source, request, true);
}
export function gutenbergBlockContext(source: HTMLElement) {
  try {
    const field = fieldFor(source);
    const selection = source.ownerDocument.getSelection();
    if (
      !field ||
      !selection?.rangeCount ||
      !selection.isCollapsed ||
      !source.contains(selection.anchorNode)
    )
      return null;
    const mapped = domPositionToOffset(field.map, selection.anchorNode!, selection.anchorOffset);
    const offset = mapped === null ? null : Math.min(mapped, field.text.length);
    if (offset === null) return null;
    return {
      blockText: field.text,
      beforeCursor: field.text.slice(0, offset),
      afterCursor: field.text.slice(offset),
    };
  } catch {
    return null;
  }
}
export function replaceGutenbergBlock(
  source: HTMLElement,
  request: Parameters<HostEditorSession["applyBlockReplacement"]>[0],
): HostEditorApplyResult {
  const before = snapshot(source, false);
  if (
    !before ||
    before.value.text !== request.expectedBlockText ||
    !gutenbergBlockContext(source) ||
    !Number.isSafeInteger(request.cursorAfter)
  )
    return { applied: false, didDispatchInput: false };
  const edit = {
    start: request.replaceStart,
    end: request.replaceEnd,
    original: before.value.text.slice(request.replaceStart, request.replaceEnd),
    replacement: request.replacementText,
  };
  const after = applyEdits(before.value.text, [edit]);
  if (after === null || request.cursorAfter < 0 || request.cursorAfter > after.length)
    return { applied: false, didDispatchInput: false };
  const result = apply(
    source,
    { edits: [edit], before: before.value.text, after, signature: before.value.signature },
    false,
    request.cursorAfter,
  );
  return {
    applied: result.status === "applied",
    didDispatchInput: false,
    ...(result.status === "unverified" ? { unverified: true } : {}),
  };
}
