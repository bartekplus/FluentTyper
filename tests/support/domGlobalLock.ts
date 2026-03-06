let domGlobalLockTail = Promise.resolve();

export async function acquireDomGlobalLock(): Promise<() => void> {
  let releaseLock!: () => void;
  const nextLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const previousLock = domGlobalLockTail;
  domGlobalLockTail = previousLock.then(() => nextLock);
  await previousLock;

  return releaseLock;
}
