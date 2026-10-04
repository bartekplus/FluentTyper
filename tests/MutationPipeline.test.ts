import { MutationPipeline } from "../src/adapters/chrome/content-script/MutationPipeline";
import { SuggestionMenuView } from "../src/adapters/chrome/content-script/suggestions/SuggestionMenuView";

function childListMutation(addedNodes: Node[], target: Node = document.body): MutationRecord {
  return {
    type: "childList",
    addedNodes: addedNodes as unknown as NodeList,
    target,
  } as unknown as MutationRecord;
}

function attributesMutation(target: Element): MutationRecord {
  return {
    type: "attributes",
    addedNodes: [] as unknown as NodeList,
    target,
  } as unknown as MutationRecord;
}

describe("MutationPipeline", () => {
  test("returns noop for empty mutation list", () => {
    const pipeline = new MutationPipeline(200, 64);

    expect(pipeline.buildPlan([])).toEqual({ type: "noop" });
  });

  test("returns full-scan for large batches", () => {
    const pipeline = new MutationPipeline(3, 64);
    const nodes = [document.createElement("div")];
    nodes.forEach((node) => document.body.appendChild(node));
    const mutations = [
      childListMutation(nodes),
      childListMutation(nodes),
      childListMutation(nodes),
    ];

    expect(pipeline.buildPlan(mutations)).toEqual({ type: "full-scan" });
  });

  test("returns top-level targeted roots only", () => {
    const pipeline = new MutationPipeline(200, 64);
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);

    const plan = pipeline.buildPlan([
      childListMutation([parent]),
      childListMutation([child], parent),
      attributesMutation(child),
    ]);

    expect(plan.type).toBe("targeted-scan");
    expect(plan).toEqual({
      type: "targeted-scan",
      roots: [parent],
    });
  });

  test("returns full-scan when root count reaches threshold", () => {
    const pipeline = new MutationPipeline(200, 2);
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.appendChild(first);
    document.body.appendChild(second);

    const plan = pipeline.buildPlan([childListMutation([first]), childListMutation([second])]);

    expect(plan).toEqual({ type: "full-scan" });
  });
});

test("FT-INV-2 typing 100 or 1000 characters never triggers editor discovery", () => {
  const pipeline = new MutationPipeline(200, 64);
  const text = document.createTextNode("x");
  document.body.append(text);
  for (const count of [100, 1000]) {
    const records = Array.from(
      { length: count },
      () =>
        ({
          type: "characterData",
          target: text,
          addedNodes: [],
        }) as unknown as MutationRecord,
    );
    expect(pipeline.buildPlan(records)).toEqual({ type: "noop" });
    records.push(childListMutation([document.createTextNode("typed")]));
    expect(pipeline.buildPlan(records)).toEqual({ type: "noop" });
    const field = document.createElement("textarea");
    document.body.append(field);
    records.push(childListMutation([field]));
    expect(pipeline.buildPlan(records)).toEqual({ type: "targeted-scan", roots: [field] });
    field.remove();
  }
  text.remove();
});

test("FT-INV-2 FluentTyper UI bursts never trigger discovery", () => {
  const pipeline = new MutationPipeline(200, 64);
  // The real shadow menu host, as the runtime makes it.
  const { menu } = SuggestionMenuView.ensureMenu();
  const overlay = document.createElement("div");
  overlay.setAttribute("data-fluenttyper-review", "true");
  document.body.append(menu, overlay);
  expect(pipeline.buildPlan(Array.from({ length: 1000 }, () => attributesMutation(menu)))).toEqual({
    type: "noop",
  });
  expect(pipeline.buildPlan([childListMutation([menu, overlay])])).toEqual({ type: "noop" });
  const field = document.createElement("input");
  document.body.append(field);
  expect(pipeline.buildPlan([childListMutation([menu, field])])).toEqual({
    type: "targeted-scan",
    roots: [field],
  });
});
