import { MutationPipeline } from "../src/adapters/chrome/content-script/MutationPipeline";

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

    expect(pipeline.buildPlan(mutations)).toEqual({
      type: "full-scan",
      reason: "large-batch",
    });
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

    expect(plan).toEqual({
      type: "full-scan",
      reason: "too-many-roots",
    });
  });
});
