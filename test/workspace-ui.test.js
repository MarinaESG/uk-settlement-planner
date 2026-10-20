import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { emptyWorkspace, validateWorkspace } from "../src/domain.js";

const source = (
  await readFile(new URL("../public/app.js", import.meta.url), "utf8")
).replace(/^import .*;\n/gm, "");
const oldRevision = "11111111-1111-4111-8111-111111111111";
const newRevision = "22222222-2222-4222-8222-222222222222";
const workspace = (note) => {
  const data = emptyWorkspace();
  data.checks[0].note = note;
  return data;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// Execute the actual connected-app controller with a small DOM/planner adapter.
// Browser acceptance also checks the real form, export download and warning.
async function screen() {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        textContent: "",
        disabled: false,
        hidden: true,
        value: "",
        children: [],
        replaceChildren() {
          this.children = [];
        },
        append(...items) {
          this.children.push(...items);
        },
        close() {},
        showModal() {},
      });
    return nodes.get(id);
  };
  const state = {
    cloud: { data: workspace("baseline"), revision: oldRevision },
    reads: 0,
    writes: 0,
    confirm: false,
    confirmations: [],
    hook: null,
  };
  let current, changed;
  const fetch = async (url, options) => {
    if (url === "/api/config")
      return Response.json({
        catalogue: [],
        authReady: true,
        privatePreview: true,
        commerce: false,
        sandboxCheckout: false,
        operator: "Fictional test",
      });
    assert.equal(url, "/api/workspace");
    assert.equal(options.headers.Authorization, "Bearer fictional-session");
    if (state.hook) await state.hook(options);
    if (options.method === "GET") {
      state.reads++;
      return Response.json(state.cloud);
    }
    if (options.headers["If-Match"] !== `"${state.cloud.revision}"`)
      return Response.json(
        { error: "Saved records changed in another tab." },
        { status: 409 },
      );
    state.writes++;
    state.cloud = { data: JSON.parse(options.body), revision: newRevision };
    return Response.json({ saved: true, revision: newRevision });
  };
  await runInNewContext(`(async()=>{${source}\n})()`, {
    $,
    document: { querySelectorAll: () => [], querySelector: () => $("monthly") },
    mountPlanner: (initial, onChange) => {
      current = initial;
      changed = onChange;
      return {
        get: () => current,
        set: (data) => {
          current = data;
        },
      };
    },
    fictional: () => workspace("fictional demo"),
    emptyWorkspace,
    validateWorkspace,
    el: () => ({ ...$("element") }),
    structuredClone,
    fetch,
    URL,
    URLSearchParams,
    location: {
      search: "",
      hash: "",
      assign() {
        throw Error("No navigation expected");
      },
    },
    sessionStorage: {
      getItem: () => "fictional-session",
      setItem() {},
      removeItem() {},
    },
    confirm: (message) => {
      state.confirmations.push(message);
      return state.confirm;
    },
  });
  return {
    $,
    state,
    current: () => structuredClone(current),
    edit: (note) => {
      current.checks[0].note = note;
      changed(current);
    },
    click: (id) => $(id).onclick(),
  };
}

test("stale-save warning preserves the draft and blocks save/delete while further editing remains possible", async () => {
  const ui = await screen();
  ui.edit("unsaved B");
  ui.state.cloud = { data: workspace("newer A"), revision: newRevision };
  await ui.click("save");
  assert.equal(ui.current().checks[0].note, "unsaved B");
  assert.equal(ui.state.cloud.data.checks[0].note, "newer A");
  assert.equal(ui.state.writes, 0);
  assert.equal(ui.$("saveConflict").hidden, false);
  assert.equal(ui.$("save").disabled, true);
  assert.equal(ui.$("delete").disabled, true);
  ui.edit("further unsaved edits");
  assert.equal(ui.$("saveConflict").hidden, false);
  assert.equal(ui.$("export").disabled, false);
  await ui.click("save"); // Even a programmatic second click cannot bypass it.
  assert.equal(ui.state.writes, 0);
});

test("cancel loading keeps the draft; explicit confirmation loads the latest version and permits a deliberate save", async () => {
  const ui = await screen();
  ui.edit("unsaved B");
  ui.state.cloud = { data: workspace("newer A"), revision: newRevision };
  await ui.click("save");
  const before = ui.current(),
    reads = ui.state.reads;
  await ui.click("loadLatest");
  assert.equal(ui.state.reads, reads);
  assert.deepEqual(ui.current(), before);
  assert.equal(ui.$("saveConflict").hidden, false);
  assert.match(ui.state.confirmations[0], /Export a backup first/);
  ui.state.confirm = true;
  await ui.click("loadLatest");
  assert.equal(ui.current().checks[0].note, "newer A");
  assert.equal(ui.$("saveConflict").hidden, true);
  assert.equal(ui.$("save").disabled, false);
  ui.edit("reviewed edit after loading");
  await ui.click("save");
  assert.equal(
    ui.state.cloud.data.checks[0].note,
    "reviewed edit after loading",
  );
});

test("editing during a save preserves newer draft changes and does not falsely label them saved", async () => {
  const ui = await screen();
  const waiting = deferred(),
    started = deferred();
  ui.state.hook = async () => {
    started.resolve();
    await waiting.promise;
  };
  ui.edit("submitted snapshot");
  const saving = ui.click("save");
  await started.promise;
  assert.equal(ui.$("save").disabled, true);
  assert.equal(ui.$("signOut").disabled, true);
  await ui.click("save"); // Duplicate requests are not sent.
  ui.edit("typed while saving");
  waiting.resolve();
  await saving;
  assert.equal(ui.state.writes, 1);
  assert.equal(ui.state.cloud.data.checks[0].note, "submitted snapshot");
  assert.equal(ui.current().checks[0].note, "typed while saving");
  assert.match(ui.$("message").textContent, /newer unsaved changes/);
  assert.equal(ui.$("save").disabled, false);
  ui.state.hook = null;
  await ui.click("save");
  assert.equal(ui.state.cloud.data.checks[0].note, "typed while saving");
});

test("a dropped connection retains the unsaved draft and its version for a safe retry", async () => {
  const ui = await screen();
  ui.edit("retain after outage");
  ui.state.hook = () => {
    throw Error("Connection unavailable");
  };
  await ui.click("save");
  assert.equal(ui.current().checks[0].note, "retain after outage");
  assert.equal(ui.state.cloud.data.checks[0].note, "baseline");
  assert.equal(ui.$("save").disabled, false);
  assert.match(ui.$("message").textContent, /Connection unavailable/);
  ui.state.hook = null;
  await ui.click("save");
  assert.equal(ui.state.cloud.data.checks[0].note, "retain after outage");
});

test("edits made while newer records are loading are retained rather than replaced by the response", async () => {
  const ui = await screen();
  ui.state.confirm = true;
  const waiting = deferred(),
    started = deferred();
  ui.state.hook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const loading = ui.click("loadLatest");
  await started.promise;
  ui.edit("typed while loading");
  waiting.resolve();
  await loading;
  assert.equal(ui.current().checks[0].note, "typed while loading");
  assert.match(
    ui.$("message").textContent,
    /more changes while records were loading/,
  );
  assert.equal(ui.$("saveConflict").hidden, false);
});

test("signing out clears conflict state and a late load response cannot restore account records", async () => {
  const ui = await screen();
  ui.state.confirm = true;
  const waiting = deferred(),
    started = deferred();
  ui.state.hook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const loading = ui.click("loadLatest");
  await started.promise;
  ui.click("signOut"); // Exercises the guard even if an external event bypasses disabled UI.
  waiting.resolve();
  await loading;
  assert.equal(ui.current().checks[0].note, "fictional demo");
  assert.match(ui.$("accountStatus").textContent, /Signed out/);
  assert.match(ui.$("message").textContent, /Signed out/);
  assert.equal(ui.$("saveConflict").hidden, true);
});
