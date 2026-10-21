import { expect, test } from "bun:test";
import { ptSingular } from "../../src/core/domain/grammar/library/portuguese/nouns";

test("ptSingular: the plurals in -ães", () => {
  expect(["mães", "pães", "cães", "alemães", "lições"].map(ptSingular)).toEqual([
    "mãe",
    "pão",
    "cão",
    "alemão",
    "lição",
  ]);
});
