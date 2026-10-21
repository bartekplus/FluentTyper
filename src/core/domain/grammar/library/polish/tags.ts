// The rule library (library.ts): the tag masks of the Polish lexicon. Rule expressions have no
// bitwise operators, so they read and join the masks with these functions.

/** The tags that `tags` and every mask in `masks` share (`tags & a & b`). */
export const tagsAnd = (tags: number, ...masks: number[]) =>
  masks.reduce((shared, mask) => shared & mask, tags);

/** The tags of all the masks (`a | b`). */
export const tagsOr = (...masks: number[]) => masks.reduce((all, mask) => all | mask, 0);

/** The tags of `tags` that are not in `mask` (`tags & ~mask`). */
export const tagsWithout = (tags: number, mask: number) => tags & ~mask;

/** The case bits of `tags` in either number, as singular bits (`(tags | (tags >> 7)) & 0x7f`). */
export const tagsCases = (tags: number) => (tags | (tags >> 7)) & 0x7f;
