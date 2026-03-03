import type { SuggestionEntry } from "./types";

export class SuggestionEntryRegistry {
  private nextEntryId = 1;
  private entries = new Map<number, SuggestionEntry>();
  private entryIdByElement = new WeakMap<Element, number>();

  public allocateId(): number {
    const id = this.nextEntryId;
    this.nextEntryId += 1;
    return id;
  }

  public register(entry: SuggestionEntry): void {
    this.entries.set(entry.id, entry);
    this.entryIdByElement.set(entry.elem, entry.id);
  }

  public unregister(id: number): SuggestionEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(id);
    this.entryIdByElement.delete(entry.elem);
    return entry;
  }

  public getById(id: number): SuggestionEntry | undefined {
    return this.entries.get(id);
  }

  public getByElement(elem: Element): SuggestionEntry | undefined {
    const id = this.entryIdByElement.get(elem);
    if (typeof id !== "number") {
      return undefined;
    }
    const entry = this.entries.get(id);
    return entry?.elem === elem ? entry : undefined;
  }

  public isAttached(elem: Element): boolean {
    return this.getByElement(elem) !== undefined;
  }

  public values(): IterableIterator<SuggestionEntry> {
    return this.entries.values();
  }

  public entriesById(): IterableIterator<[number, SuggestionEntry]> {
    return this.entries.entries();
  }

  public ids(): IterableIterator<number> {
    return this.entries.keys();
  }

  public get size(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
    this.entryIdByElement = new WeakMap<Element, number>();
  }
}
