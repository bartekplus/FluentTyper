// Types for the part of "bun:test" and the Bun global that the tests use.
// The project does not install bun-types, so this file gives tsc only the
// API that the tests call. Matchers and the Bun global stay loose.
/* oxlint-disable typescript/no-explicit-any -- the loose parts use any on purpose */

type AnyFn = (...args: any[]) => any;

interface BunMockState<T extends AnyFn> {
  calls: Parameters<T>[];
  results: Array<{ type: string; value: any }>;
  instances: any[];
  invocationCallOrder: number[];
  lastCall?: Parameters<T>;
}

type BunMock<T extends AnyFn = AnyFn> = T & {
  mock: BunMockState<T>;
  mockImplementation(fn: T): BunMock<T>;
  mockImplementationOnce(fn: T): BunMock<T>;
  getMockImplementation(): T | undefined;
  mockReturnValue(value: ReturnType<T>): BunMock<T>;
  mockReturnValueOnce(value: ReturnType<T>): BunMock<T>;
  mockResolvedValue(value: Awaited<ReturnType<T>>): BunMock<T>;
  mockResolvedValueOnce(value: Awaited<ReturnType<T>>): BunMock<T>;
  mockRejectedValue(value: unknown): BunMock<T>;
  mockRejectedValueOnce(value: unknown): BunMock<T>;
  mockClear(): BunMock<T>;
  mockReset(): BunMock<T>;
  mockRestore(): void;
};

type BunTestCallback = (...args: any[]) => unknown;

interface BunTestFn {
  (name: string, fn?: BunTestCallback, options?: number | Record<string, unknown>): void;
  only: BunTestFn;
  skip: BunTestFn;
  todo: BunTestFn;
  if(condition: boolean): BunTestFn;
  skipIf(condition: boolean): BunTestFn;
  each<T extends Readonly<[any, ...any[]]>>(
    table: readonly T[],
  ): (name: string, fn: (...args: [...T]) => unknown, options?: number) => void;
  each<T extends any[]>(
    table: readonly T[],
  ): (name: string, fn: (...args: Readonly<T>) => unknown, options?: number) => void;
  each<T>(table: readonly T[]): (name: string, fn: (arg: T) => unknown, options?: number) => void;
}

interface BunMatchers {
  not: BunMatchers;
  resolves: BunMatchers;
  rejects: BunMatchers;
  [matcher: string]: any;
}

interface BunExpect {
  (actual?: unknown, message?: string): BunMatchers;
  [asymmetricMatcher: string]: any;
}

declare namespace BunJest {
  type Mock<T extends AnyFn = AnyFn> = BunMock<T>;
  function fn<T extends AnyFn = AnyFn>(fn?: T): BunMock<T>;
  function spyOn<T extends object, K extends keyof T>(
    object: T,
    key: K,
  ): T[K] extends AnyFn ? BunMock<T[K]> : BunMock;
  function restoreAllMocks(): void;
  function clearAllMocks(): void;
  function useFakeTimers(): void;
  function useRealTimers(): void;
  function advanceTimersByTime(ms: number): void;
  function clearAllTimers(): void;
}

// Bun also gives the test API as globals.
declare const describe: BunTestFn;
declare const test: BunTestFn;
declare const it: BunTestFn;
declare const expect: BunExpect;
declare function beforeAll(fn: BunTestCallback, timeout?: number): void;
declare function afterAll(fn: BunTestCallback, timeout?: number): void;
declare function beforeEach(fn: BunTestCallback, timeout?: number): void;
declare function afterEach(fn: BunTestCallback, timeout?: number): void;
import jest = BunJest;

declare module "bun:test" {
  export type Mock<T extends AnyFn = AnyFn> = BunMock<T>;
  export const describe: BunTestFn;
  export const test: BunTestFn;
  export const it: BunTestFn;
  export const expect: BunExpect;
  export function beforeAll(fn: BunTestCallback, timeout?: number): void;
  export function afterAll(fn: BunTestCallback, timeout?: number): void;
  export function beforeEach(fn: BunTestCallback, timeout?: number): void;
  export function afterEach(fn: BunTestCallback, timeout?: number): void;
  export function setSystemTime(now?: Date | number): void;
  export const spyOn: typeof BunJest.spyOn;
  export const mock: {
    <T extends AnyFn = AnyFn>(fn?: T): BunMock<T>;
    module(path: string, factory: () => unknown): void;
    restore(): void;
  };
  export import jest = BunJest;
}

declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: any;
    serialize(): string;
  }
  export class VirtualConsole {}
}

declare const Bun: any;

interface ImportMeta {
  dir: string;
}
