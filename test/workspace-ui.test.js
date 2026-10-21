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
async function screen(configOverrides = {}, initialCloud, options = {}) {
  const storage = options.storage || new Map([["sp-session", "fictional-session"]]);
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
  const buys = ["monthly", "download"].map((kind) => {
    const node = $(kind);
    node.dataset = { buy: kind };
    return node;
  });
  const state = {
    purchaseRequests: 0,
    cloud: initialCloud || {
      data: workspace("baseline"),
      revision: oldRevision,
      ownerId: "owner-a",
      updated: "2026-10-20T12:00:00Z",
    },
    authHook: null,
    authResponse: null,
    unload: null,
    reads: 0,
    writes: 0,
    confirm: false,
    confirmations: [],
    hook: null,
    response: options.response || null,
    acknowledge: null,
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
        ...configOverrides,
      });
    if (url === "/api/auth/otp") {
      if (state.authHook) await state.authHook();
      if (state.authResponse) return state.authResponse();
      return Response.json({ token: "fictional-session" });
    }
    assert.equal(url, "/api/workspace");
    assert.equal(options.headers.Authorization, "Bearer fictional-session");
    if (state.hook) await state.hook(options);
    if (state.response) return state.response();
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
    state.cloud = {
      ...state.cloud,
      data: JSON.parse(options.body),
      revision: newRevision,
    };
    if (state.acknowledge) return state.acknowledge();
    return Response.json({ saved: true, revision: newRevision });
  };
  await runInNewContext(`(async()=>{${source}\n})()`, {
    $,
    document: {
      querySelectorAll: (selector) => (selector === "[data-buy]" ? buys : []),
      querySelector: () => $("monthly"),
    },
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
    window: {
      addEventListener: (name, fn) => {
        if (name === "beforeunload") state.unload = fn;
      },
    },
    location: {
      search: "",
      hash: "",
      assign() {
        throw Error("No navigation expected");
      },
    },
    sessionStorage: {
      getItem: (key) => {
        if (options.storageReadBlocked) throw Error("Storage blocked");
        return storage.get(key) || null;
      },
      setItem: (key, value) => {
        if (options.storageWriteBlocked) throw Error("Storage full");
        storage.set(key, value);
      },
      removeItem: (key) => storage.delete(key),
    },
    confirm: (message) => {
      state.confirmations.push(message);
      return state.confirm;
    },
  });
  return {
    $,
    state,
    storage,
    current: () => structuredClone(current),
    edit: (note) => {
      current.checks[0].note = note;
      changed(current);
    },
    editWorkspace: (data) => {
      current = structuredClone(data);
      changed(current);
    },
    reload: (overrides = {}) => screen(configOverrides, state.cloud, {
      ...options, storage, ...overrides,
    }),
    click: (id) => $(id).onclick(),
    signIn: () => $("authForm").onsubmit({ preventDefault() {} }),
  };
}

test("stale-save warning preserves the draft and blocks save/delete while further editing remains possible", async () => {
  const ui = await screen();
  ui.edit("unsaved B");
  ui.state.cloud = { ...ui.state.cloud, data: workspace("newer A"), revision: newRevision };
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
  ui.state.cloud = { ...ui.state.cloud, data: workspace("newer A"), revision: newRevision };
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

test("failed-save warning survives edits, other status messages and repeated failures until a successful retry", async () => {
  const ui = await screen();
  assert.equal(ui.$("saveFailure").hidden, true);
  const original = structuredClone(ui.state.cloud);
  ui.edit("retain after outage");
  ui.state.hook = () => {
    throw TypeError("Load failed");
  };
  await ui.click("save");
  assert.equal(ui.current().checks[0].note, "retain after outage");
  assert.deepEqual(ui.state.cloud, original);
  assert.equal(ui.$("save").disabled, false);
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.doesNotMatch(ui.$("message").textContent, /Load failed/);
  ui.edit("further unsaved changes");
  assert.equal(ui.$("saveFailure").hidden, false);
  // The real planner writes export/import results to this separate status area.
  ui.$("message").textContent = "Backup exported. Keep it somewhere private.";
  assert.equal(ui.$("saveFailure").hidden, false);
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.deepEqual(ui.state.cloud, original);
  const waiting = deferred(),
    started = deferred();
  ui.state.hook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const retry = ui.click("save");
  await started.promise;
  assert.equal(ui.$("saveFailure").hidden, false);
  ui.edit("newer edit during retry");
  waiting.resolve();
  await retry;
  assert.equal(ui.$("saveFailure").hidden, true);
  assert.equal(ui.state.cloud.data.checks[0].note, "further unsaved changes");
  assert.equal(ui.current().checks[0].note, "newer edit during retry");
  assert.match(ui.$("message").textContent, /newer unsaved changes/);
  ui.state.hook = null;
  await ui.click("save");
  assert.equal(ui.state.cloud.data.checks[0].note, "newer edit during retry");
  assert.equal(ui.$("message").textContent, "Workspace saved to your account.");
});

test("server failures and incomplete acknowledgements retain the warning; specific access errors stay actionable", async () => {
  const ui = await screen();
  ui.edit("unsaved draft");
  for (const response of [
    () => Response.json({ error: "Provider unavailable" }, { status: 503 }),
    () => Response.json({ saved: true }),
    () => Response.json({ saved: false, revision: newRevision }),
    () => Response.json({ saved: true, revision: "invalid" }),
    () => new Response("truncated response", { status: 200 }),
    () => Response.json({ error: "Sign in again." }, { status: 401 }),
  ]) {
    ui.state.response = response;
    await ui.click("save");
    assert.equal(ui.$("saveFailure").hidden, false);
    assert.equal(ui.current().checks[0].note, "unsaved draft");
    assert.equal(ui.state.cloud.data.checks[0].note, "baseline");
    assert.equal(ui.state.writes, 0);
  }
  assert.equal(ui.$("message").textContent, "Sign in again.");
  ui.state.response = null;
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, true);
  assert.equal(ui.state.cloud.data.checks[0].note, "unsaved draft");
});

test("a lost acknowledgement cannot cause a retry to overwrite saved data or discard newer edits", async () => {
  const ui = await screen();
  ui.edit("sent before disconnect");
  ui.state.acknowledge = () => {
    throw TypeError("Failed to fetch");
  };
  await ui.click("save");
  assert.equal(ui.state.cloud.data.checks[0].note, "sent before disconnect");
  assert.equal(ui.$("saveFailure").hidden, false);
  ui.edit("newer unsaved edit");
  ui.state.acknowledge = null;
  await ui.click("save");
  assert.equal(ui.state.writes, 1);
  assert.equal(ui.state.cloud.data.checks[0].note, "sent before disconnect");
  assert.equal(ui.current().checks[0].note, "newer unsaved edit");
  assert.equal(ui.$("saveConflict").hidden, false);
  assert.equal(ui.$("saveFailure").hidden, false);
  await ui.click("loadLatest"); // Cancelling a replacement retains the warning.
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.equal(ui.current().checks[0].note, "newer unsaved edit");
  ui.state.confirm = true;
  await ui.click("loadLatest");
  assert.equal(ui.$("saveFailure").hidden, true);
  assert.equal(ui.current().checks[0].note, "sent before disconnect");
});

test("signing out does not carry a failed-save warning into the fictional demo", async () => {
  const ui = await screen();
  ui.edit("unsaved draft");
  ui.state.hook = () => {
    throw TypeError("Load failed");
  };
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, false);
  ui.click("signOut");
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.equal(ui.current().checks[0].note, "unsaved draft");
  ui.state.confirm = true;
  ui.click("signOut");
  assert.equal(ui.$("saveFailure").hidden, true);
  assert.equal(ui.current().checks[0].note, "fictional demo");
  assert.match(ui.$("message").textContent, /Signed out/);
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

test("expired sign-in recovery preserves the same owner's draft until a deliberate successful save", async () => {
  const ui = await screen();
  const original = structuredClone(ui.state.cloud);
  ui.edit("draft after expiry");
  const draft = ui.current();
  ui.state.response = () =>
    Response.json({ error: "Sign in again." }, { status: 401 });
  await ui.click("save");
  assert.equal(ui.$("resumeSignIn").hidden, false);
  assert.equal(ui.$("save").hidden, true);
  assert.equal(ui.$("saveFailure").hidden, false);
  ui.state.response = null;
  await ui.signIn();
  assert.deepEqual(ui.current(), draft);
  assert.deepEqual(ui.state.cloud, original);
  assert.equal(ui.state.writes, 0);
  assert.equal(ui.state.confirmations.length, 0);
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.equal(ui.$("resumeSignIn").hidden, true);
  assert.match(ui.$("message").textContent, /unsaved draft is preserved/);
  await ui.click("save");
  assert.deepEqual(ui.state.cloud.data, draft);
  assert.equal(ui.$("saveFailure").hidden, true);
});

test("recovery preserves edits entered while the sign-in code is being verified", async () => {
  const ui = await screen();
  const original = structuredClone(ui.state.cloud);
  const waiting = deferred(), started = deferred();
  ui.state.authHook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const pending = ui.signIn();
  await started.promise;
  ui.edit("typed while verifying");
  const draft = ui.current();
  waiting.resolve();
  await pending;
  assert.deepEqual(ui.current(), draft);
  assert.deepEqual(ui.state.cloud, original);
  assert.equal(ui.state.confirmations.length, 0);
  assert.equal(ui.$("authMessage").textContent, "");
  await ui.click("save");
  assert.deepEqual(ui.state.cloud.data, draft);
});

test("recovery preserves further edits made while the cloud revision is being checked", async () => {
  const ui = await screen();
  ui.edit("draft before sign-in");
  const original = structuredClone(ui.state.cloud);
  const waiting = deferred(), started = deferred();
  ui.state.hook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const pending = ui.signIn();
  await started.promise;
  ui.edit("latest edit while recovering");
  const draft = ui.current();
  waiting.resolve();
  await pending;
  assert.deepEqual(ui.current(), draft);
  assert.deepEqual(ui.state.cloud, original);
  assert.equal(ui.$("authMessage").textContent, "");
  assert.equal(ui.$("saveConflict").hidden, true);
  ui.state.hook = null;
  await ui.click("save");
  assert.deepEqual(ui.state.cloud.data, draft);
});

test("sign-in alone cannot clear a failed-save warning even when the draft has no new edits", async () => {
  const ui = await screen();
  const original = structuredClone(ui.state.cloud);
  ui.state.response = () =>
    Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, false);
  ui.state.response = null;
  await ui.signIn();
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.deepEqual(ui.state.cloud, original);
  assert.deepEqual(ui.current(), original.data);
  assert.equal(ui.state.writes, 0);
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, true);
  assert.equal(ui.state.writes, 1);
});

test("failed verification, a failed recovery read and another failed save all retain the draft and warning", async () => {
  const ui = await screen();
  const original = structuredClone(ui.state.cloud);
  ui.edit("complete draft to recover");
  const draft = ui.current();
  ui.state.response = () =>
    Response.json({ error: "Your session has expired. Sign in again." }, { status: 401 });
  await ui.click("save");
  ui.state.authResponse = () =>
    Response.json({ error: "Code has expired. Request a new code." }, { status: 400 });
  await ui.signIn();
  assert.match(ui.$("authMessage").textContent, /Request a new code/);
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.deepEqual(ui.current(), draft);
  assert.deepEqual(ui.state.cloud, original);

  ui.state.authResponse = null;
  ui.state.response = () =>
    Response.json({ error: "Account service unavailable." }, { status: 502 });
  await ui.signIn();
  assert.match(ui.$("authMessage").textContent, /unavailable/);
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.deepEqual(ui.current(), draft);
  assert.deepEqual(ui.state.cloud, original);

  ui.state.response = null;
  await ui.signIn();
  assert.equal(ui.$("authMessage").textContent, "");
  assert.equal(ui.$("saveFailure").hidden, false);
  ui.state.response = () => {
    throw TypeError("Connection lost");
  };
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, false);
  assert.deepEqual(ui.current(), draft);
  assert.deepEqual(ui.state.cloud, original);
  assert.equal(ui.state.writes, 0);
  ui.state.response = null;
  await ui.click("save");
  assert.equal(ui.$("saveFailure").hidden, true);
  assert.deepEqual(ui.state.cloud.data, draft);
});

test("initial sign-in does not replace demo edits made after replacement was confirmed", async () => {
  const ui = await screen();
  ui.click("signOut");
  ui.edit("demo before verification");
  ui.state.confirm = true;
  const waiting = deferred(), started = deferred();
  ui.state.authHook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const pending = ui.signIn();
  await started.promise;
  ui.edit("demo edited after confirmation");
  const draft = ui.current();
  waiting.resolve();
  await pending;
  assert.deepEqual(ui.current(), draft);
  assert.match(ui.$("authMessage").textContent, /more changes while records were loading/);
  assert.equal(ui.state.writes, 0);
  assert.equal(ui.$("save").disabled, true);
});

test("re-authentication detects newer cloud records without silently replacing the draft", async () => {
  const ui = await screen();
  ui.edit("my draft");
  ui.state.cloud = {
    ...ui.state.cloud,
    data: workspace("newer cloud"),
    revision: newRevision,
  };
  await ui.signIn();
  assert.equal(ui.current().checks[0].note, "my draft");
  assert.equal(ui.state.cloud.data.checks[0].note, "newer cloud");
  assert.equal(ui.$("saveConflict").hidden, false);
  assert.equal(ui.$("save").disabled, true);
  assert.equal(ui.state.writes, 0);
});

test("a different verified account cannot acquire or save the previous account's unsaved draft", async () => {
  const ui = await screen();
  ui.edit("original owner's draft");
  ui.state.cloud = { ...ui.state.cloud, ownerId: "owner-b" };
  await ui.signIn();
  assert.match(ui.$("authMessage").textContent, /account that owns this draft/);
  assert.equal(ui.current().checks[0].note, "original owner's draft");
  assert.equal(ui.state.writes, 0);
});

test("an older workspace response without an owner cannot enable unsafe sign-in recovery", async () => {
  const ui = await screen({}, { data: workspace("cloud"), revision: oldRevision });
  assert.equal(ui.current().checks[0].note, "fictional demo");
  assert.match(ui.$("message").textContent, /Saving protection is not ready/);
  assert.equal(ui.$("save").disabled, true);
  assert.equal(ui.state.writes, 0);
});

test("late sign-in verification cannot undo a deliberate sign-out", async () => {
  const ui = await screen();
  const waiting = deferred(),
    started = deferred();
  ui.state.authHook = async () => {
    started.resolve();
    await waiting.promise;
  };
  const pending = ui.signIn();
  await started.promise;
  ui.click("signOut");
  waiting.resolve();
  await pending;
  assert.equal(ui.current().checks[0].note, "fictional demo");
  assert.match(ui.$("message").textContent, /Signed out/);
});

test("leaving with a dirty draft requests the browser warning; successful save removes it", async () => {
  const ui = await screen();
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  ui.state.unload(event);
  assert.equal(prevented, 0);
  ui.edit("unsaved work");
  ui.state.unload(event);
  assert.equal(prevented, 1);
  await ui.click("save");
  ui.state.unload(event);
  assert.equal(prevented, 1);
});

test("refresh recovers every draft field without a cloud write or backup import, then successful save removes the copy", async () => {
  const ui = await screen();
  const baseline = structuredClone(ui.state.cloud);
  const draft = workspace("FICTIONAL refresh draft");
  draft.trips = [{ departure: "2026-09-01", arrival: "2026-09-08", evidence: "fictional evidence", reviewer: "typed without leaving field", status: "User-reported" }];
  draft.permissions = [{route: "fictional permission", start: "2025-01-01", end: "2027-01-01", evidence: "fictional grant", status: "User-reported"}];
  ui.editWorkspace(draft);
  assert.match(ui.$("storageStatus").textContent, /recovery copy kept/);
  const reloaded = await ui.reload();
  assert.deepEqual(reloaded.current(), draft);
  assert.deepEqual(reloaded.state.cloud, baseline);
  assert.equal(reloaded.state.writes, 0);
  assert.equal(reloaded.$("save").disabled, false);
  assert.equal(reloaded.$("workspaceEditor").hidden, false);
  assert.equal(reloaded.$("draftRecovery").hidden, false);
  assert.match(reloaded.$("draftRecovery").textContent, /recovered after refresh/);
  reloaded.edit("edit after recovery");
  assert.match(reloaded.$("draftRecovery").textContent, /not been saved to your account/);
  await reloaded.click("save");
  assert.deepEqual(reloaded.state.cloud.data, reloaded.current());
  assert.equal(reloaded.storage.has("msr-tab-draft-v1"), false);
  assert.equal(reloaded.$("draftRecovery").hidden, true);
  const savedReload = await reloaded.reload();
  assert.deepEqual(savedReload.current(), reloaded.current());
  assert.equal(savedReload.$("draftRecovery").hidden, true);
});

test("expired session after refresh hides account data until matching sign-in, then restores draft and failure warning", async () => {
  const ui = await screen();
  ui.edit("private recovered draft");
  ui.state.response = () => Response.json({error:"Sign in again."},{status:401});
  await ui.click("save");
  const reloaded = await ui.reload({response:ui.state.response});
  assert.equal(reloaded.current().checks[0].note, "fictional demo");
  assert.equal(reloaded.$("workspaceEditor").hidden, true);
  assert.equal(reloaded.$("importButton").disabled, true);
  assert.equal(reloaded.$("export").disabled, true);
  assert.equal(reloaded.$("save").disabled, true);
  assert.match(reloaded.$("draftRecovery").textContent, /same account/);
  assert.equal(reloaded.$("saveFailure").hidden, false);
  reloaded.state.response = null;
  await reloaded.signIn();
  assert.deepEqual(reloaded.current(), ui.current());
  assert.equal(reloaded.state.confirmations.length, 0);
  assert.equal(reloaded.$("saveFailure").hidden, false);
  assert.equal(reloaded.$("export").disabled, false);
  assert.equal(reloaded.state.writes, 0);
  await reloaded.click("save");
  assert.equal(reloaded.$("saveFailure").hidden, true);
  assert.equal(reloaded.storage.has("msr-tab-draft-v1"), false);
});

test("a newer cloud revision after refresh leaves the entire draft recoverable and saving blocked", async () => {
  const ui = await screen();
  ui.edit("older unsaved draft");
  ui.state.cloud = {...ui.state.cloud, data:workspace("newer saved record"), revision:newRevision};
  const reloaded = await ui.reload();
  assert.deepEqual(reloaded.current(), ui.current());
  assert.equal(reloaded.$("saveConflict").hidden, false);
  assert.match(reloaded.$("draftRecovery").textContent, /newer cloud version/);
  assert.equal(reloaded.$("save").disabled, true);
  await reloaded.click("save");
  await reloaded.click("loadLatest"); // Cancel must retain both screen and copy.
  assert.equal(reloaded.state.writes, 0);
  assert.deepEqual((await reloaded.reload()).current(), ui.current());
  reloaded.state.confirm = true;
  await reloaded.click("loadLatest");
  assert.equal(reloaded.current().checks[0].note, "newer saved record");
  assert.equal(reloaded.storage.has("msr-tab-draft-v1"), false);
});

test("another verified account cannot view or acquire a stored draft; the owner can recover it later", async () => {
  const ui = await screen();
  ui.edit("owner A private draft");
  const ownerCloud = structuredClone(ui.state.cloud);
  ui.state.cloud = {...ui.state.cloud,ownerId:"owner-b",data:workspace("owner B cloud")};
  const reloaded = await ui.reload();
  assert.equal(reloaded.current().checks[0].note, "fictional demo");
  assert.equal(reloaded.$("workspaceEditor").hidden, true);
  assert.match(reloaded.$("message").textContent, /account that owns this draft/);
  assert.equal(reloaded.$("save").disabled, true);
  reloaded.state.cloud = ownerCloud;
  await reloaded.signIn();
  assert.equal(reloaded.current().checks[0].note, "owner A private draft");
  assert.equal(reloaded.state.writes, 0);
});

test("draft survives absent session credentials and restores only after owner sign-in", async () => {
  const ui = await screen();
  ui.edit("recover after sign-in");
  ui.storage.delete("sp-session");
  const reloaded = await ui.reload();
  assert.equal(reloaded.state.reads, 0);
  assert.equal(reloaded.$("workspaceEditor").hidden, true);
  await reloaded.signIn();
  assert.equal(reloaded.current().checks[0].note, "recover after sign-in");
  assert.equal(reloaded.state.confirmations.length, 0);
});

test("unfinished date edits survive refresh but strict cloud save validation still rejects them", async () => {
  const ui = await screen();
  const draft = workspace("dates being edited");
  draft.trips = [{departure:"2026-09-09",arrival:"2026-09-08",evidence:"fictional",status:"User-reported",reviewer:"preserve all input"}];
  draft.period.start = "2026-10-01";
  draft.period.end = "2026-09-01";
  ui.editWorkspace(draft);
  const reloaded = await ui.reload();
  assert.deepEqual(reloaded.current(),draft);
  await reloaded.click("save");
  assert.equal(reloaded.state.writes,0);
  assert.match(reloaded.$("message").textContent,/Invalid review period/);
});

test("storage quota failure is explicit and an older recovery copy is not mistaken for the latest draft", async () => {
  const options = {storageWriteBlocked:false};
  const ui = await screen({},undefined,options);
  ui.edit("old edit");
  options.storageWriteBlocked = true;
  ui.edit("latest edit after quota failure");
  assert.equal(ui.current().checks[0].note,"latest edit after quota failure");
  assert.equal(ui.storage.has("msr-tab-draft-v1"),false);
  assert.equal(ui.$("draftRecovery").hidden,false);
  assert.match(ui.$("draftRecovery").textContent,/couldn’t keep a recovery copy/);
  assert.doesNotMatch(ui.$("storageStatus").textContent,/recovery copy kept/);
  await ui.click("save");
  assert.equal(ui.state.cloud.data.checks[0].note,"latest edit after quota failure");
  assert.equal(ui.$("draftRecovery").hidden,true);
});

test("blocked storage does not crash the app or claim draft protection", async () => {
  const ui = await screen({},undefined,{storageReadBlocked:true,storageWriteBlocked:true});
  assert.equal(ui.$("save").disabled,true);
  assert.match(ui.$("draftRecovery").textContent,/recovery may be unavailable/);
  await ui.signIn();
  ui.edit("in memory only");
  assert.equal(ui.current().checks[0].note,"in memory only");
  assert.match(ui.$("draftRecovery").textContent,/couldn’t keep a recovery copy/);
});

test("malformed recovery content is not rendered and the cloud copy remains intact", async () => {
  for (const corrupt of ['{broken','{"version":99}',JSON.stringify({version:1,ownerId:"owner-a",revision:oldRevision,failed:false,data:{version:1,trips:null}})]) {
    const ui = await screen({},undefined,{storage:new Map([["sp-session","fictional-session"],["msr-tab-draft-v1",corrupt]])});
    assert.equal(ui.current().checks[0].note,"baseline");
    assert.equal(ui.state.writes,0);
    assert.match(ui.$("draftRecovery").textContent,/couldn’t read a recovery copy/);
  }
});

test("confirmed sign-out removes the tab draft and cannot expose it to a later account", async () => {
  const ui = await screen();
  ui.edit("private draft");
  ui.click("signOut"); // Cancel.
  assert.equal(ui.storage.has("msr-tab-draft-v1"),true);
  ui.state.confirm = true;
  ui.click("signOut");
  assert.equal(ui.storage.has("msr-tab-draft-v1"),false);
  assert.equal(ui.storage.has("sp-session"),false);
  const reloaded = await ui.reload();
  assert.equal(reloaded.current().checks[0].note,"fictional demo");
  assert.equal(reloaded.$("draftRecovery").hidden,true);
});

test("edits made while a save is in flight survive refresh with the acknowledged base revision", async () => {
  const ui = await screen();
  ui.edit("submitted");
  const waiting = deferred(), started = deferred();
  ui.state.hook = async () => {started.resolve();await waiting.promise;};
  const saving = ui.click("save");
  await started.promise;
  ui.edit("newest keystrokes");
  waiting.resolve();
  await saving;
  const reloaded = await ui.reload();
  assert.equal(reloaded.current().checks[0].note,"newest keystrokes");
  assert.equal(reloaded.state.cloud.data.checks[0].note,"submitted");
  assert.equal(reloaded.$("saveConflict").hidden,true);
  await reloaded.click("save");
  assert.equal(reloaded.state.cloud.data.checks[0].note,"newest keystrokes");
});

test("independent tabs keep separate recovery drafts", async () => {
  const a = await screen(), b = await screen();
  a.edit("tab A draft");
  b.edit("tab B draft");
  assert.equal((await a.reload()).current().checks[0].note,"tab A draft");
  assert.equal((await b.reload()).current().checks[0].note,"tab B draft");
});
