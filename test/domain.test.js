import test from "node:test";
import assert from "node:assert/strict";
import {
  dateDay,
  wholeDays,
  analyse,
  validateWorkspace,
  emptyWorkspace,
} from "../src/domain.js";
const trip = (departure, arrival) => ({
  departure,
  arrival,
  status: "Reviewed",
  evidence: "FICTIONAL evidence reference",
});
test("workspace validation strips undocumented fields at every level without mutating the backup", () => {
  const expected = { ...emptyWorkspace(),
    trips: [{ ...trip("2026-09-01", "2026-09-08"), reviewer: "Fictional reviewer" }],
    permissions: [{ route: "Fictional", start: "", end: "", evidence: "Reference", status: "To check" }],
  };
  const original = structuredClone(expected);
  original.user_id = "another-account";
  original.privateAttachment = { secret: "Do not retain" };
  original.period.hidden = { passport: "fictional" };
  original.trips[0].passport = "fictional";
  original.permissions[0].document = { content: "fictional" };
  original.checks[0].unrelated = ["fictional"];
  const unchanged = structuredClone(original);
  const validated = validateWorkspace(original);
  assert.deepEqual(validated, expected);
  assert.deepEqual(original, unchanged);
  validated.trips[0].reviewer = "Changed after validation";
  assert.equal(original.trips[0].reviewer, "Fictional reviewer");
});
test("validation preserves supported incomplete and older backups exactly", () => {
  const older = { version: 1, route: "long-residence", trips: [trip("", "")],
    permissions: [{ route: "Fictional", evidence: "", status: "To check" }], checks: [] };
  for (const backup of [emptyWorkspace(), older]) {
    assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(backup))), backup);
  }
});
test("objects cannot be smuggled into optional text or boolean fields", () => {
  for (const value of [null, false, 0, "", [], { start: {} }, { end: 0 },
    { allTripsReported: "true" }, { reconciled: {} }]) {
    assert.throws(() => validateWorkspace({ ...emptyWorkspace(), period: value }), /Invalid review period/);
  }
  assert.throws(() => validateWorkspace({ ...emptyWorkspace(),
    trips: [{ ...trip("", ""), reviewer: { hidden: "value" } }] }), /Invalid trip/);
  assert.throws(() => validateWorkspace({ ...emptyWorkspace(),
    permissions: [{ route: "Example", evidence: "", status: "To check", start: [] }] }), /Invalid permission/);
  assert.throws(() => validateWorkspace({ ...emptyWorkspace(), hidden: "x".repeat(150001) }), /150 KB/);
});
test("whole days exclude departure and arrival, including leap dates", () => {
  assert.equal(wholeDays("2020-02-28", "2020-03-01"), 1);
  assert.equal(wholeDays("2022-06-03", "2022-06-19"), 15);
  assert.equal(wholeDays("2020-03-01", "2020-03-01"), 0);
  assert.equal(dateDay("2023-02-29"), null);
  assert.equal(wholeDays("2022-12-01", "2022-11-01"), null);
});
test("legacy trip crossing April cutoff: only pre-cutoff days in aggregate, no post rolling contribution", () => {
  const a = analyse([trip("2024-04-08", "2024-04-15")]);
  assert.equal(a.wholeDays, 6);
  assert.equal(a.preDays, 2);
  assert.equal(a.maxRolling, 0);
});
test("post-cutoff and duplicate intervals do not inflate rolling maximum", () => {
  const a = analyse([
    trip("2024-04-11", "2024-04-20"),
    trip("2024-04-11", "2024-04-20"),
  ]);
  assert.equal(a.maxRolling, 8);
  assert.equal(a.wholeDays, 8);
  assert.match(a.issues.join(), /overlapping/);
});
test("rolling year is calendar-based and flags 181 whole days", () => {
  const a = analyse([trip("2025-01-01", "2025-07-02")]);
  assert.equal(a.maxRolling, 181);
  assert.match(a.issues.join(), /exceeds 180/);
});
test("pre-change single-trip boundary and evidence flags", () => {
  assert.equal(
    analyse([trip("2023-01-01", "2023-07-05")]).results[0].wholeDays,
    184,
  );
  assert.doesNotMatch(
    analyse([trip("2023-01-01", "2023-07-05")]).issues.join(),
    /exceeds 184/,
  );
  assert.match(
    analyse([trip("2023-01-01", "2023-07-06")]).issues.join(),
    /exceeds 184/,
  );
  assert.match(
    analyse([
      { ...trip("2023-01-01", "2023-01-03"), evidence: "" },
    ]).issues.join(),
    /unverified/,
  );
});
test("malformed imports and invalid permission spans are rejected", () => {
  assert.equal(validateWorkspace(emptyWorkspace()).version, 1);
  assert.throws(() => validateWorkspace({ version: 3 }));
  assert.throws(() =>
    validateWorkspace({
      ...emptyWorkspace(),
      trips: [trip("2025-02-30", "2025-03-03")],
    }),
  );
  assert.throws(() =>
    validateWorkspace({
      ...emptyWorkspace(),
      permissions: [
        {
          route: "Example",
          start: "2025-02-01",
          end: "2024-02-01",
          evidence: "",
          status: "User-reported",
        },
      ],
    }),
  );
});
test("review period clips aggregate days but retains boundary warning", () => {
  const a = analyse([trip("2024-03-01", "2024-04-15")], {
    start: "2024-04-01",
    end: "2024-04-30",
    allTripsReported: true,
    reconciled: true,
  });
  assert.equal(a.wholeDays, 14);
  assert.equal(a.preDays, 10);
  assert.equal(a.maxRolling, 0);
  assert.match(a.issues.join(), /boundary/);
});
test("trips wholly outside review period do not trigger its numerical limit", () => {
  const a = analyse([trip("2020-01-01", "2021-01-01")], {
    start: "2025-01-01",
    end: "2025-12-31",
  });
  assert.equal(a.wholeDays, 0);
  assert.doesNotMatch(a.issues.join(), /exceeds 184/);
});
test("incomplete drafts can be backed up while invalid dates cannot", () => {
  const s = emptyWorkspace();
  s.trips = [
    { departure: "", arrival: "", status: "User-reported", evidence: "" },
  ];
  assert.equal(validateWorkspace(s).trips.length, 1);
  assert.match(analyse(s.trips).issues.join(), /invalid dates/);
  assert.ok(analyse([], { start: "2025-01-01", end: "" }).error);
});
