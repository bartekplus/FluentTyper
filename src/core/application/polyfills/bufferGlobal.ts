import { Buffer } from "buffer";

const maybeGlobal = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
};

if (typeof maybeGlobal.Buffer === "undefined") {
  maybeGlobal.Buffer = Buffer;
}
