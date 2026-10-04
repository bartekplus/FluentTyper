import { describe, expect, it } from "bun:test";

import { parseCliOptions } from "../scripts/run-e2e";

describe("run-e2e parseCliOptions", () => {
  it("keeps inline values on passthrough options", () => {
    expect(parseCliOptions(["--suite=full", "--test-name-pattern=foo"])).toEqual({
      mode: "production",
      platform: "chrome",
      suite: "full",
      headed: false,
      passthroughArgs: ["--test-name-pattern=foo"],
    });
  });

  it("passes through short options, positionals, and terminated args verbatim", () => {
    expect(
      parseCliOptions(["-t", "foo", "some/file.test.ts", "--", "--bail"]).passthroughArgs,
    ).toEqual(["-t", "foo", "some/file.test.ts", "--", "--bail"]);
  });

  it("does not expand or rewrite unknown short options", () => {
    expect(parseCliOptions(["-abc", "--mode", "development", "-t=foo"]).passthroughArgs).toEqual([
      "-abc",
      "-t=foo",
    ]);
  });

  it("rejects known options without a usable value", () => {
    expect(() => parseCliOptions(["--mode"])).toThrow("Unsupported mode: true");
    expect(() => parseCliOptions(["--headed=false"])).toThrow("Unsupported headed: false");
    expect(() => parseCliOptions(["--platform=safari"])).toThrow("Unsupported platform: safari");
    expect(() => parseCliOptions(["--shards=0"])).toThrow("Unsupported shards: 0");
    expect(() => parseCliOptions(["--shards=1.5"])).toThrow("Unsupported shards: 1.5");
  });

  it("reads the shard count and keeps it out of the passthrough args", () => {
    expect(parseCliOptions(["--shards", "3", "--bail"])).toMatchObject({
      shards: 3,
      passthroughArgs: ["--bail"],
    });
    expect(parseCliOptions([]).shards).toBeUndefined();
  });
});
