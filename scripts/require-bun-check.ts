// `bun run typecheck` calls Bun's built-in type checker as `bun --check`.
// Bun before 1.4.3 has no type checker: `bun --check` prints its help and exits 0,
// so an old Bun would pass the type check without checking anything. Fail instead.
const MIN_VERSION = "1.4.3";

if (!Bun.semver.satisfies(Bun.version, `>=${MIN_VERSION}`)) {
  console.error(
    `error: type checking needs Bun ${MIN_VERSION} or later, found ${Bun.version}. Run \`bun upgrade\`.`,
  );
  process.exit(1);
}
