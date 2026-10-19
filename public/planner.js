import {
  analyse,
  wholeDays,
  emptyWorkspace,
  validateWorkspace,
} from "/domain.js";
import { catalogue } from "/catalogue.js";
export const $ = (id) => document.getElementById(id);
export function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
export function fictional() {
  const s = emptyWorkspace();
  s.period.start = "2020-09-01";
  s.period.end = "2026-10-01";
  s.trips = [
    {
      departure: "2022-06-03",
      arrival: "2022-06-19",
      status: "User-reported",
      evidence: "FICTIONAL: reconcile booking and arrival record",
      reviewer: "",
    },
  ];
  s.permissions = [
    {
      route: "Student — fictional example",
      start: "2020-09-01",
      end: "2023-10-31",
      status: "User-reported",
      evidence: "FICTIONAL: exact dates need grant-letter review",
    },
  ];
  return s;
}
export function mountPlanner(initial, onChange = () => {}) {
  let state = initial,
    tab = "trips";
  function changed() {
    onChange(state);
  }
  const select = $("route");
  for (const r of catalogue) {
    const o = el("option", r.name);
    o.value = r.id;
    select.append(o);
  }
  function field(parent, label, key, obj, type = "text", options) {
    const l = el("label", label),
      input = el(
        options ? "select" : type === "textarea" ? "textarea" : "input",
      );
    if (options) {
      for (const v of options) {
        const o = el("option", v);
        o.value = v;
        input.append(o);
      }
    } else if (type !== "textarea") input.type = type;
    input.value = obj[key] || "";
    if (type !== "date") input.maxLength = 3000;
    input.addEventListener("change", () => {
      obj[key] = input.value;
      changed();
      indicators();
      if (tab === "trips")
        document.querySelectorAll(".trip-days").forEach((n, i) => {
          n.textContent =
            String(
              wholeDays(state.trips[i].departure, state.trips[i].arrival) ??
                "Invalid",
            ) + " whole days";
        });
    });
    l.append(input);
    parent.append(l);
    return input;
  }
  function indicators() {
    const panel = $("indicators");
    panel.replaceChildren();
    if (state.route !== "long-residence") {
      panel.append(
        el(
          "p",
          "This route has evidence organisation only. No qualifying-period or absence-rule calculation is provided.",
          "notice",
        ),
      );
      return;
    }
    const a = analyse(state.trips, state.period || {});
    if (a.error) {
      panel.append(el("p", a.error, "notice"));
      return;
    }
    const metrics = el("div", undefined, "metrics");
    for (const [v, label] of [
      [
        a.wholeDays,
        a.scoped
          ? "Whole absence days in review period"
          : "Whole absence days across all records",
      ],
      [a.preDays, "Whole days before 11 April 2024"],
      [a.maxRolling, "Post-change rolling maximum"],
    ]) {
      const box = el("div");
      box.append(el("strong", String(v)), el("span", label));
      metrics.append(box);
    }
    panel.append(metrics);
    const list = el("ul");
    for (const issue of a.issues) list.append(el("li", issue));
    if (!a.issues.length)
      list.append(
        el(
          "li",
          "No arithmetic flags in the dates entered. This is not an eligibility result.",
        ),
      );
    panel.append(
      list,
      el(
        "p",
        "Scope: the selected review period, or all records if no period is set. Departure and arrival days are excluded. Pre-change trips use the 184-day indicator; pre-cutoff days use 548 total; trips starting from 11 April 2024 use 180 days in rolling 12-month windows. Overlaps count once. Exceptions are not deducted. The app does not establish whether your chosen period qualifies.",
        "small",
      ),
    );
  }
  function periodFields() {
    let panel = $("periodFields");
    if (!panel) {
      panel = el("div");
      panel.id = "periodFields";
      $("routeNote").after(panel);
    }
    panel.replaceChildren();
    if (state.route !== "long-residence") return;
    state.period ??= {
      start: "",
      end: "",
      allTripsReported: false,
      reconciled: false,
    };
    const grid = el("div", undefined, "record-fields");
    field(grid, "Proposed review period: from", "start", state.period, "date");
    field(
      grid,
      "Review through (not an eligibility date)",
      "end",
      state.period,
      "date",
    );
    panel.append(grid);
    for (const [key, label] of [
      ["allTripsReported", "I have entered all trips in this review period"],
      ["reconciled", "I have reconciled the dates against supporting records"],
    ]) {
      const l = el("label", undefined, "checkbox"),
        input = el("input");
      input.type = "checkbox";
      input.checked = state.period[key] === true;
      input.onchange = () => {
        state.period[key] = input.checked;
        changed();
        indicators();
      };
      l.append(input, el("span", label));
      panel.append(l);
    }
  }
  function render() {
    select.value = state.route;
    const route = catalogue.find((r) => r.id === state.route);
    $("routeNote").textContent =
      (route?.note || "Unknown route: select a catalogue entry.") +
      " Official source reviewed " +
      (route?.reviewed || "not recorded") +
      ".";
    periodFields();
    const editor = $("editor");
    editor.replaceChildren();
    const records = state[tab];
    if (!records.length)
      editor.append(el("p", "No records entered yet. Add one below.", "muted"));
    records.forEach((record, i) => {
      const card = el("article", undefined, "record");
      card.append(
        el(
          "h3",
          tab === "checks"
            ? record.name
            : `${tab === "trips" ? "Trip" : "Permission"} ${i + 1}`,
        ),
      );
      const grid = el("div", undefined, "record-fields");
      card.append(grid);
      if (tab === "trips") {
        field(grid, "Departure from UK", "departure", record, "date");
        field(grid, "Arrival back in UK", "arrival", record, "date");
        field(
          grid,
          "Evidence reference / storage location",
          "evidence",
          record,
        );
        field(grid, "Reviewed by / review date", "reviewer", record);
        card.append(
          el(
            "p",
            String(wholeDays(record.departure, record.arrival) ?? "Invalid") +
              " whole days",
            "small trip-days",
          ),
        );
      }
      if (tab === "permissions") {
        field(grid, "Permission route", "route", record);
        field(
          grid,
          "Valid from (leave unknown dates blank)",
          "start",
          record,
          "date",
        );
        field(grid, "Valid until", "end", record, "date");
        field(
          grid,
          "Grant / application evidence references",
          "evidence",
          record,
        );
      }
      field(
        grid,
        "Review status",
        "status",
        record,
        "text",
        tab === "checks"
          ? ["To check", "In progress", "Reviewed"]
          : ["User-reported", "Evidence linked", "Reviewed"],
      );
      if (tab === "checks")
        field(
          grid,
          "Evidence, owner, gaps and next action",
          "note",
          record,
          "textarea",
        );
      else {
        const remove = el("button", "Remove record", "remove");
        remove.onclick = () => {
          records.splice(i, 1);
          changed();
          render();
        };
        card.append(remove);
      }
      editor.append(card);
    });
    if (tab !== "checks") {
      const add = el(
        "button",
        "+ Add " + (tab === "trips" ? "trip" : "permission"),
      );
      add.onclick = () => {
        if (records.length >= (tab === "trips" ? 500 : 200)) return;
        records.push(
          tab === "trips"
            ? {
                departure: "",
                arrival: "",
                evidence: "",
                reviewer: "",
                status: "User-reported",
              }
            : {
                route: "",
                start: "",
                end: "",
                evidence: "",
                status: "User-reported",
              },
        );
        changed();
        render();
      };
      editor.append(add);
    }
    indicators();
  }
  select.onchange = () => {
    state.route = select.value;
    changed();
    render();
  };
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        document
          .querySelectorAll("[data-tab]")
          .forEach((n) => n.classList.toggle("selected", n === b));
        render();
      }),
  );
  $("export").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = el("a");
    a.href = url;
    a.download = "settlement-planner-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("message").textContent = "Backup exported. Keep it somewhere private.";
  };
  $("import").onchange = async (e) => {
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 150000) throw Error("Backup exceeds 150 KB.");
      const next = validateWorkspace(JSON.parse(await f.text()));
      if (!confirm("Replace the records currently on screen with this backup?"))
        return;
      state = next;
      changed();
      render();
      $("message").textContent = "Backup imported. Review it before saving.";
    } catch (e) {
      $("message").textContent = e.message;
    } finally {
      e.target.value = "";
    }
  };
  render();
  return {
    get: () => state,
    set: (s) => {
      state = s;
      render();
    },
  };
}
