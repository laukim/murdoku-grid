/**
 * Signed-in Google accounts that may PUT any saved layout.
 * The row keeps its original user_sub. Delete stays owner-only.
 * Any other signed-in account is a guest: view-only on the map,
 * with solve progress stored separately from the layout row.
 */
export const LIBRARY_EDITOR_EMAILS = [
  "mocholateio@gmail.com",
  "kim.lau817@gmail.com",
];

const EDITORS = new Set(LIBRARY_EDITOR_EMAILS);

export function canUpdateAnyLayout(email) {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && EDITORS.has(normalized);
}
