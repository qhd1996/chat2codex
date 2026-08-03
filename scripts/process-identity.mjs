export function sameProcessIdentity(left, right) {
  return Boolean(
    left && right &&
    Number(left.pid) === Number(right.pid) &&
    String(left.createdAt) === String(right.createdAt),
  );
}

export function processIdExists(pid) {
  const value = Number(pid);
  if (!Number.isSafeInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function descendantIdentities(rows, root) {
  const byParent = new Map();
  for (const row of rows) {
    const parent = Number(row.parentPid);
    const values = byParent.get(parent) ?? [];
    values.push(row);
    byParent.set(parent, values);
  }
  const result = [];
  const queue = [root];
  const seen = new Set([`${root.pid}|${root.createdAt}`]);
  while (queue.length) {
    const parent = queue.shift();
    for (const child of byParent.get(Number(parent.pid)) ?? []) {
      if (String(child.createdAt) < String(root.createdAt)) continue;
      const key = `${child.pid}|${child.createdAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}
