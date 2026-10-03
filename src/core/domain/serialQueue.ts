/**
 * Returns a function that runs each task after the previous task ends.
 * A task error goes to the caller of that task only. It does not stop the next task.
 */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
