// The rule library (library/english.ts): a cache that rule code keeps in a Map def. A def that
// calls a function at module load stays in every bundle that loads the rule module (the content
// scripts too), so rule code fills its caches on first use.

/** `read(key)` through `cache`; the cache is emptied when it holds `max` answers. */
export function readThrough<T>(
  cache: Map<string, T>,
  key: string,
  read: (key: string) => T,
  max: number,
): T {
  const known = cache.get(key);
  if (known !== undefined || cache.has(key)) return known as T;
  if (cache.size >= max) cache.clear();
  const answer = read(key);
  cache.set(key, answer);
  return answer;
}
