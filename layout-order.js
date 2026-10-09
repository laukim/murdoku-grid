/** Natural order for library titles such as "Vol1 #5" before "Vol1 #11". */

export function titleHasNumber(title) {
  return /\d/.test(String(title || ""));
}

function naturalParts(title) {
  const parts = [];
  const text = String(title || "").trim().toLowerCase();
  for (const match of text.matchAll(/(\d+)|(\D+)/g)) {
    if (match[1] != null) parts.push(Number(match[1]));
    else parts.push(match[2]);
  }
  return parts;
}

export function compareNaturalTitles(a, b) {
  const ap = naturalParts(a);
  const bp = naturalParts(b);
  const length = Math.max(ap.length, bp.length);
  for (let i = 0; i < length; i++) {
    const x = ap[i];
    const y = bp[i];
    if (x == null) return -1;
    if (y == null) return 1;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum && x !== y) return x - y;
    if (xNum !== yNum) return xNum ? -1 : 1;
    if (!xNum && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Numbered titles first, in numeric order. Other titles keep newest-first. */
export function compareLayouts(a, b) {
  const aNum = titleHasNumber(a?.title);
  const bNum = titleHasNumber(b?.title);
  if (aNum !== bNum) return aNum ? -1 : 1;
  if (aNum && bNum) {
    const byTitle = compareNaturalTitles(a.title, b.title);
    if (byTitle !== 0) return byTitle;
  }
  const aTime = a?.updated_at || "";
  const bTime = b?.updated_at || "";
  if (aTime !== bTime) return aTime < bTime ? 1 : -1;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

export function sortLayouts(layouts) {
  return [...layouts].sort(compareLayouts);
}
