// Test-build instrumentation. This file is never imported by an extension entry point.
(() => {
  const { Document, DocumentFragment, Element, Node, chrome } = globalThis;
  const counters = {
    listeners: 0,
    observers: 0,
    input: 0,
    scans: 0,
    layout: 0,
    mutations: 0,
    messages: 0,
  };
  const samples = [];
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const targets = new WeakMap();
  const references = new Set();
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!listener) return add.call(this, type, listener, options);
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const signal = typeof options === "object" ? options?.signal : undefined;
    if (signal?.aborted) return;
    let records = targets.get(this);
    if (!records) {
      targets.set(this, (records = []));
      references.add(new WeakRef(this));
    }
    if (records.some((r) => r.type === type && r.listener === listener && r.capture === capture))
      return;
    const record = { type, listener, capture, wrapper: null, cleanup: null };
    const cleanup = () => {
      const index = records.indexOf(record);
      if (index < 0) return;
      records.splice(index, 1);
      counters.listeners--;
      if (signal) remove.call(signal, "abort", cleanup);
    };
    record.cleanup = cleanup;
    record.wrapper = function (event) {
      if (typeof options === "object" && options?.once) cleanup();
      const timed = /^(beforeinput|input|keydown|selectionchange)$/.test(type);
      const start = timed ? performance.now() : 0;
      try {
        return typeof listener === "function"
          ? listener.call(this, event)
          : listener.handleEvent(event);
      } finally {
        if (timed) {
          counters.input++;
          if (samples.length === 4096) samples.shift();
          samples.push(performance.now() - start);
        }
      }
    };
    records.push(record);
    counters.listeners++;
    if (signal) add.call(signal, "abort", cleanup, { once: true });
    return add.call(this, type, record.wrapper, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const record = targets
      .get(this)
      ?.find((r) => r.type === type && r.listener === listener && r.capture === capture);
    if (record) record.cleanup();
    return remove.call(this, type, record?.wrapper ?? listener, options);
  };
  for (const name of ["MutationObserver", "ResizeObserver"]) {
    const Original = globalThis[name];
    if (!Original) continue;
    globalThis[name] = class extends Original {
      active = false;
      constructor(callback) {
        super((records, observer) => {
          counters.mutations++;
          callback(records, observer);
        });
      }
      observe(...args) {
        super.observe(...args);
        if (!this.active) {
          this.active = true;
          counters.observers++;
        }
      }
      disconnect() {
        super.disconnect();
        if (this.active) {
          this.active = false;
          counters.observers--;
        }
      }
    };
  }
  counters.timers = 0;
  counters.frames = 0;
  const timerIds = new Set();
  for (const [scheduleName, cancelName, category, repeat] of [
    ["setTimeout", "clearTimeout", "timers", false],
    ["setInterval", "clearInterval", "timers", true],
    ["requestAnimationFrame", "cancelAnimationFrame", "frames", false],
  ]) {
    const schedule = globalThis[scheduleName]?.bind(globalThis);
    const cancel = globalThis[cancelName]?.bind(globalThis);
    if (!schedule || !cancel) continue;
    const active = category === "timers" ? timerIds : new Set();
    globalThis[scheduleName] = (callback, ...args) => {
      if (typeof callback !== "function") return schedule(callback, ...args);
      const id = schedule(
        (...values) => {
          if (!repeat && active.delete(id)) counters[category]--;
          callback(...values);
        },
        ...args,
      );
      active.add(id);
      counters[category]++;
      return id;
    };
    globalThis[cancelName] = (id) => {
      if (active.delete(id)) counters[category]--;
      return cancel(id);
    };
  }
  for (const prototype of [Document.prototype, Element.prototype, DocumentFragment.prototype]) {
    const query = prototype.querySelectorAll;
    prototype.querySelectorAll = function (...args) {
      counters.scans++;
      return query.apply(this, args);
    };
  }
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (...args) {
    counters.layout++;
    return rect.apply(this, args);
  };
  counters.pendingMessages = 0;
  counters.maxPendingMessages = 0;
  counters.reviewRequests = 0;
  if (globalThis.chrome?.runtime?.sendMessage) {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function (...args) {
      counters.messages++;
      if (args[0]?.command === "CMD_CONTENT_SCRIPT_REVIEW_ENGINE") counters.reviewRequests++;
      counters.pendingMessages++;
      counters.maxPendingMessages = Math.max(counters.maxPendingMessages, counters.pendingMessages);
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          counters.pendingMessages--;
        }
      };
      const callback = args.at(-1);
      if (typeof callback === "function")
        args[args.length - 1] = (...values) => {
          finish();
          return callback(...values);
        };
      try {
        const result = send(...args);
        if (result?.then)
          return result.then(
            (value) => {
              finish();
              return value;
            },
            (error) => {
              finish();
              throw error;
            },
          );
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    };
  }
  globalThis.__ftPerformance = () => {
    let attachedListeners = 0;
    let detachedListenerCandidates = 0;
    for (const reference of references) {
      const target = reference.deref();
      if (!target) {
        references.delete(reference);
        continue;
      }
      const count = targets.get(target)?.length ?? 0;
      if (target instanceof Node && !target.isConnected) detachedListenerCandidates += count;
      else attachedListeners += count;
    }
    if (references.size > 10000) throw new Error("Probe target limit exceeded.");
    return {
      ...counters,
      listeners: attachedListeners,
      detachedListenerCandidates,
      handlerMs: samples.slice(),
    };
  };
})();
