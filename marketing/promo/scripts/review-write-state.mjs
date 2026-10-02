/** A written draft is ready to film only once its native diagnostics have caught up. */
export function isReviewWriteComplete(text, panel, expectedText, expectedIssues) {
  return (
    text === expectedText &&
    panel.open &&
    panel.spelling === "done" &&
    panel.items.length === expectedIssues &&
    panel.fixAll.disabled === (expectedIssues === 0)
  );
}
