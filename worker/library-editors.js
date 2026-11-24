/**
 * Signed-in Google accounts that may PUT any saved layout.
 * The row keeps its original user_sub. Delete stays owner-only.
 * Everyone else, including signed-out visitors, is unchanged.
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
