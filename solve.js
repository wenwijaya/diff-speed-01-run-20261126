// Fast drop-in for makefun-diff 1.0.0 (make.fun's own line diff).
//
// Same answer as makefun-diff 1.0.0's diffPatch on every input, faster:
// lines are interned to small integers once (so the search compares ints,
// not strings), the Myers search keeps only one small int per diagonal per
// edit distance (no per-path objects, no linked lists), and the edit script
// is recovered by walking those diagonals back from the end.
//
// The rule, as the competition states it: a text is cut after every "\n"
// (a "\r" is part of its line); a last line with no "\n" is a line too.
// Two lines are equal only when the same code units, newline or its absence
// included. The common prefix of lines is kept, then the common suffix of
// the lines left; between them Myers's greedy search from the first lines,
// which keeps on each diagonal the path reaching furthest into the old text
// and, when a deletion and an insertion reach the same point, the deletion's,
// never moves past either text's end, prunes no edge diagonal, and follows
// every run of lines equal in both as far as it goes; the first path to
// reach both ends is the script. The patch: a line
// "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I", then each
// hunk's line "@ os ol ns nl" and one line per line it covers, "=" kept,
// "-" deleted, "+" inserted; each run of changes lists its deletions before
// its insertions and shows up to 3 kept lines before and after it, and two
// runs at most 6 kept lines apart share a hunk. A line that ends its text
// with no newline is written with one and followed by a line "%". Identical
// texts are the first line alone.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const lines = new Array(parts.length);
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines[i] = parts[i] + '\n';
  if (parts[last] !== '') lines[last] = parts[last];
  else lines.length = last;
  return lines;
}

/**
 * The edit script of the middle slices a[0..n) into b[0..m), as runs
 * [{ kind, count }] in order, by Myers's greedy search with the deletion
 * tie-break. The forward pass keeps, for each edit distance d, the furthest
 * old-line count reached on each diagonal k (x, with y = x - k); the script
 * is then recovered by walking back from the first (d, k) to reach both ends.
 */
function editRuns(a, b, n, m) {
  // d = 0: the snake from (0, 0) on diagonal 0. Stored values hold x + 1
  // (0 means "no path on this diagonal"), so a fresh Int32Array needs no fill.
  let x0 = 0;
  while (x0 < n && x0 < m && a[x0] === b[x0]) x0++;
  if (x0 === n && x0 === m) return [];
  const Vs = [new Int32Array([x0 + 1])];
  const maxD = n + m;
  let D = -1;
  let K = 0;
  outer: for (let d = 1; d <= maxD; d++) {
    const prev = Vs[d - 1];
    const plen = prev.length;
    const v = new Int32Array(2 * d + 1);
    // k = -d: only the insertion from diagonal -d + 1 can reach it.
    let xInsPrev = prev[0];
    if (xInsPrev > 0) {
      const x = xInsPrev - 1;
      let y = x + d;
      let xx = x;
      let yy = y;
      while (xx < n && yy < m && a[xx] === b[yy]) { xx++; yy++; }
      v[0] = xx + 1;
      if (xx === n && yy === m) { Vs.push(v); D = d; K = -d; break outer; }
    }
    // Middle diagonals: both neighbours exist in prev.
    for (let k = -d + 2, j = 2; k < d; k += 2, j += 2) {
      const xDelPrev = prev[j - 2];
      const xInsPrev2 = prev[j];
      const canRemove = xDelPrev > 0 && xDelPrev - 1 < n;
      const canAdd = xInsPrev2 > 0 && xInsPrev2 - 1 - (k + 1) < m;
      if (!canRemove && !canAdd) continue;
      let x;
      if (canRemove && (!canAdd || xDelPrev + 1 >= xInsPrev2)) x = xDelPrev;
      else x = xInsPrev2 - 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[j] = x + 1;
      if (x === n && y === m) { Vs.push(v); D = d; K = k; break outer; }
    }
    // k = d: only the deletion from diagonal d - 1 can reach it.
    const xDelPrev = prev[plen - 1];
    if (xDelPrev > 0 && xDelPrev - 1 < n) {
      let x = xDelPrev;
      let y = x - d;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[2 * d] = x + 1;
      if (x === n && y === m) { Vs.push(v); D = d; K = d; break outer; }
    }
    Vs.push(v);
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Walk back from (D, K): each step is one edit plus the snake after it.
  const rev = [];
  let d = D;
  let k = K;
  let x = Vs[D][K + D] - 1;
  while (d > 0) {
    const prev = Vs[d - 1];
    const j = k + d;
    let del;
    let xEdit;
    if (k === -d) { del = false; xEdit = prev[0] - 1; }
    else if (k === d) { del = true; xEdit = prev[prev.length - 1]; }
    else {
      const xDelPrev = prev[j - 2];
      const xInsPrev = prev[j];
      const canRemove = xDelPrev > 0 && xDelPrev - 1 < n;
      const canAdd = xInsPrev > 0 && xInsPrev - 1 - (k + 1) < m;
      del = canRemove && (!canAdd || xDelPrev + 1 >= xInsPrev);
      xEdit = del ? xDelPrev : xInsPrev - 1;
    }
    const snake = x - xEdit;
    if (snake > 0) rev.push(KEEP, snake);
    rev.push(del ? DELETE : INSERT, 1);
    if (del) { k--; x = xEdit - 1; }
    else { k++; x = xEdit; }
    d--;
  }
  // The d = 0 snake from (0, 0).
  if (x > 0) rev.push(KEEP, x);

  // Reverse into forward order, merging runs of one kind.
  const runs = [];
  for (let i = rev.length - 2; i >= 0; i -= 2) {
    const kind = rev[i];
    const count = rev[i + 1];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line, out) {
  if (line.charCodeAt(line.length - 1) === 10) out.push(op + line);
  else out.push(op + line + '\n%\n');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const aStr = tokenize(input.old);
  const bStr = tokenize(input.new);
  const n = aStr.length;
  const m = bStr.length;
  // Identical texts are the first line alone.
  if (input.old === input.new) {
    return `${FORMAT} old=${n} new=${m} hunks=0 deleted=0 inserted=0\n`;
  }

  // Intern every distinct line to a small integer, once per case.
  const ids = new Map();
  let nextId = 0;
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let id = ids.get(aStr[i]);
    if (id === undefined) { id = nextId++; ids.set(aStr[i], id); }
    a[i] = id;
  }
  const b = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    let id = ids.get(bStr[i]);
    if (id === undefined) { id = nextId++; ids.set(bStr[i], id); }
    b[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix), n - prefix - suffix, m - prefix - suffix));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) written('=', aStr[at], out);
      for (let i = 0; i < c.dels; i++) written('-', aStr[c.o + i], out);
      for (let i = 0; i < c.ins; i++) written('+', bStr[c.p + i], out);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) written('=', aStr[at], out);
  }
  return out.join('');
}
