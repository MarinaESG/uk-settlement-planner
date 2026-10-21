const DAY = 86400000;
export function dateDay(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const n = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s
    ? n / DAY
    : null;
}
export function wholeDays(departure, arrival) {
  const a = dateDay(departure),
    b = dateDay(arrival);
  return a === null || b === null || b < a ? null : Math.max(0, b - a - 1);
}
function yearBefore(d) {
  const x = new Date(d * DAY),
    y = x.getUTCFullYear() - 1,
    m = x.getUTCMonth();
  return (
    Date.UTC(
      y,
      m,
      Math.min(x.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()),
    ) / DAY
  );
}
export function analyse(trips, period = {}) {
  const cut = dateDay("2024-04-11"),
    pre = new Set(),
    post = new Set(),
    all = new Set(),
    issues = [],
    results = [];
  const start = dateDay(period.start),
    end = dateDay(period.end),
    scoped = start !== null && end !== null;
  if (
    (period.start || period.end) &&
    (!scoped || end < start || end - start > 20000)
  )
    return {
      error:
        "Enter both review dates in order, no more than 20,000 days apart.",
      issues: [],
      results: [],
    };
  if (!scoped)
    issues.push(
      "Choose a review period. These indicators currently include every trip entered.",
    );
  if (!period.allTripsReported)
    issues.push("Completeness of the travel record has not been confirmed.");
  if (!period.reconciled)
    issues.push(
      "Travel history has not been reconciled to supporting records.",
    );
  if (!Array.isArray(trips) || trips.length > 500)
    throw Error("Maximum 500 trips.");
  for (const [i, t] of trips.entries()) {
    const full = wholeDays(t.departure, t.arrival),
      a = dateDay(t.departure),
      b = dateDay(t.arrival);
    if (full === null || full > 20000) {
      issues.push(`Trip ${i + 1}: invalid dates or span exceeds 20,000 days.`);
      continue;
    }
    const lo = scoped ? Math.max(a + 1, start) : a + 1,
      hi = scoped ? Math.min(b - 1, end) : b - 1;
    let overlap = false;
    for (let d = lo; d <= hi; d++) {
      if (all.has(d)) overlap = true;
      all.add(d);
      if (d < cut) pre.add(d);
      if (a >= cut) post.add(d);
    }
    if (overlap)
      issues.push(`Trip ${i + 1}: overlapping dates; reconcile the records.`);
    if (scoped && lo <= hi && (a < start || b > end))
      issues.push(
        `Trip ${i + 1}: crosses a review boundary; check the qualifying-period treatment. The single-trip indicator uses the full trip.`,
      );
    if (a < cut && full > 184 && lo <= hi)
      issues.push(
        `Trip ${i + 1}: exceeds 184 whole days; review the rules and any exception.`,
      );
    if (t.status !== "Reviewed" || !t.evidence?.trim())
      issues.push(`Trip ${i + 1}: supporting evidence remains unverified.`);
    results.push({
      wholeDays: full,
      inPeriod: Math.max(0, hi - lo + 1),
      regime: a < cut ? "Before 11 April 2024" : "From 11 April 2024",
    });
  }
  const days = [...post].sort((a, b) => a - b);
  let left = 0,
    maxRolling = 0;
  for (let right = 0; right < days.length; right++) {
    const from = yearBefore(days[right]) + 1;
    while (days[left] < from) left++;
    maxRolling = Math.max(maxRolling, right - left + 1);
  }
  if (pre.size > 548)
    issues.push(
      "Pre-change total exceeds 548 days; review the rules and any exception.",
    );
  if (maxRolling > 180)
    issues.push(
      "Post-change rolling maximum exceeds 180 days; review the rules and any exception.",
    );
  return {
    wholeDays: all.size,
    preDays: pre.size,
    maxRolling,
    results,
    issues,
    scoped,
  };
}
export function validateWorkspace(s) {
  if (!s || typeof s !== "object" || Array.isArray(s) || s.version !== 1)
    throw Error("Unsupported backup format.");
  if (
    typeof s.route !== "string" ||
    s.route.length > 80 ||
    !Array.isArray(s.trips) ||
    s.trips.length > 500 ||
    !Array.isArray(s.permissions) ||
    s.permissions.length > 200 ||
    !Array.isArray(s.checks) ||
    s.checks.length > 50
  )
    throw Error("Invalid workspace.");
  if (s.period !== undefined) {
    if (
      !s.period ||
      typeof s.period !== "object" ||
      Array.isArray(s.period) ||
      (s.period.start !== undefined && typeof s.period.start !== "string") ||
      (s.period.end !== undefined && typeof s.period.end !== "string") ||
      (s.period.allTripsReported !== undefined && typeof s.period.allTripsReported !== "boolean") ||
      (s.period.reconciled !== undefined && typeof s.period.reconciled !== "boolean") ||
      (s.period.start && dateDay(s.period.start) === null) ||
      (s.period.end && dateDay(s.period.end) === null) ||
      (s.period.start && s.period.end && s.period.end < s.period.start)
    )
      throw Error("Invalid review period.");
  }
  for (const t of s.trips) {
    if (
      typeof t !== "object" ||
      !t || Array.isArray(t) ||
      typeof t.departure !== "string" ||
      typeof t.arrival !== "string" ||
      (t.departure && dateDay(t.departure) === null) ||
      (t.arrival && dateDay(t.arrival) === null) ||
      (t.departure &&
        t.arrival &&
        (wholeDays(t.departure, t.arrival) === null ||
          wholeDays(t.departure, t.arrival) > 20000)) ||
      typeof t.evidence !== "string" ||
      typeof t.status !== "string" ||
      (t.reviewer !== undefined && typeof t.reviewer !== "string")
    )
      throw Error("Invalid trip.");
  }
  for (const p of s.permissions) {
    if (
      !p ||
      typeof p !== "object" || Array.isArray(p) ||
      typeof p.route !== "string" ||
      typeof p.evidence !== "string" ||
      typeof p.status !== "string" ||
      (p.start !== undefined && typeof p.start !== "string") ||
      (p.end !== undefined && typeof p.end !== "string") ||
      (p.start && dateDay(p.start) === null) ||
      (p.end && dateDay(p.end) === null) ||
      (p.start && p.end && p.end < p.start)
    )
      throw Error("Invalid permission record.");
  }
  for (const c of s.checks) {
    if (
      !c ||
      typeof c !== "object" || Array.isArray(c) ||
      typeof c.name !== "string" ||
      typeof c.status !== "string" ||
      typeof c.note !== "string"
    )
      throw Error("Invalid evidence check.");
  }
  if (JSON.stringify(s).length > 150000)
    throw Error("Workspace exceeds 150 KB.");
  // Reconstruct the documented format at every import and cloud-save boundary.
  // Do not keep hidden fields, account IDs or arbitrary nested JSON from a file.
  const pick = (record, keys) => Object.fromEntries(
    keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]),
  );
  return {
    version: 1,
    route: s.route,
    ...(s.period ? { period: pick(s.period, ["start", "end", "allTripsReported", "reconciled"]) } : {}),
    trips: s.trips.map((t) => pick(t, ["departure", "arrival", "evidence", "status", "reviewer"])),
    permissions: s.permissions.map((p) => pick(p, ["route", "start", "end", "evidence", "status"])),
    checks: s.checks.map((c) => pick(c, ["name", "status", "note"])),
  };
}
export function emptyWorkspace() {
  return {
    version: 1,
    route: "long-residence",
    period: { start: "", end: "", allTripsReported: false, reconciled: false },
    trips: [],
    permissions: [],
    checks: [
      "Identity and exact permission dates",
      "All travel reported and reconciled",
      "Current route and route-specific qualifying period",
      "English language and exemptions",
      "Life in the UK and exemptions",
      "Suitability and application requirements",
      "Official rules reviewed for intended application date",
    ].map((name) => ({ name, status: "To check", note: "" })),
  };
}
