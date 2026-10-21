import { mountPlanner, fictional, $, el } from "/planner.js";
import { emptyWorkspace, validateWorkspace } from "/domain.js";
const draftKey = "msr-tab-draft-v1";
let draftStorageIssue = "",
  draftKept = false,
  draftRecovered = false;
function sessionToken() {
  try {
    return sessionStorage.getItem("sp-session") || "";
  } catch {
    return "";
  }
}
// Recover unfinished dates too; cloud saves still use strict date validation.
function checkDraftData(data) {
  const copy = structuredClone(data);
  if (JSON.stringify(copy).length > 150000) throw Error("Draft too large");
  const blankDates = (record, keys) => {
    for (const key of keys) {
      if (record[key] !== undefined && typeof record[key] !== "string")
        throw Error("Invalid draft field");
      record[key] = "";
    }
  };
  if (copy.period) blankDates(copy.period, ["start", "end"]);
  for (const trip of copy.trips) {
    blankDates(trip, ["departure", "arrival"]);
    if (trip.reviewer !== undefined && typeof trip.reviewer !== "string")
      throw Error("Invalid reviewer");
  }
  for (const permission of copy.permissions)
    blankDates(permission, ["start", "end"]);
  validateWorkspace(copy);
  return data;
}
function readTabDraft() {
  try {
    const raw = sessionStorage.getItem(draftKey);
    if (!raw) return null;
    if (raw.length > 152000) throw Error("Draft too large");
    const draft = JSON.parse(raw);
    if (
      draft.version !== 1 ||
      typeof draft.ownerId !== "string" || !draft.ownerId ||
      !(draft.revision === null || typeof draft.revision === "string") ||
      typeof draft.failed !== "boolean"
    ) throw Error("Invalid draft");
    checkDraftData(draft.data);
    return draft;
  } catch {
    draftStorageIssue = "We couldn’t read a recovery copy in this tab. Keep any JSON backups. Browser draft recovery may be unavailable.";
    return null;
  }
}
let pendingDraft = readTabDraft();
let config,
  token = sessionToken(),
  product = "",
  revision,
  conflict = false,
  saving = false,
  changes = 0,
  dirty = false,
  authenticated = false,
  expired = false,
  ownerId,
  savedAt = null,
  authAttempt = 0,
  verifying = false;
const planner = mountPlanner(fictional(), () => {
  changes++;
  dirty = true;
  updateStatus();
  $("message").textContent = conflict
    ? "Changes on screen are unsaved. Export a backup before loading the latest saved records."
    : "Changes on screen are unsaved. Export a backup or save to your account.";
});
async function api(path, method = "GET", data, headers = {}) {
  const r = await fetch("/api/" + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) {
    const d = await r.json();
    const error = Error(d.error || "Request failed.");
    error.status = r.status;
    if (r.status === 401 && token) {
      expired = true;
      updateStatus();
    }
    throw error;
  }
  return r;
}
function message(e) {
  $("message").textContent = e.message || String(e);
}
function rememberDraft() {
  // A demo or another account must never replace a waiting account's draft.
  if (pendingDraft || !ownerId) return;
  try {
    if (dirty || !$("saveFailure").hidden) {
      const data = checkDraftData(planner.get());
      sessionStorage.setItem(draftKey, JSON.stringify({
        version: 1, ownerId, revision, data, savedAt,
        failed: !$("saveFailure").hidden,
      }));
      draftKept = true;
      draftStorageIssue = "";
    } else {
      sessionStorage.removeItem(draftKey);
      draftKept = false;
      draftRecovered = false;
    }
  } catch {
    draftKept = false;
    draftStorageIssue = "This browser couldn’t keep a recovery copy of your latest edits. They are still on screen. Save to your account or export a JSON backup before refreshing.";
    // Do not offer an older copy as if it contained the latest edit.
    try { sessionStorage.removeItem(draftKey); } catch { /* Storage is blocked. */ }
  }
}
function updateStatus() {
  if (pendingDraft?.failed) $("saveFailure").hidden = false;
  rememberDraft();
  $("draftRecovery").hidden = !(pendingDraft || draftKept || draftStorageIssue);
  $("draftRecovery").textContent = pendingDraft
    ? "An unsaved draft is waiting in this browser tab. Sign in to the same account to recover it. Your cloud records have not been changed."
    : draftStorageIssue || (draftRecovered
      ? expired
        ? "Your unsaved draft was recovered after refresh. Sign in again to save it. Your cloud records have not been changed."
        : conflict
          ? "Your unsaved draft was recovered after refresh. A newer cloud version exists. Export this draft before loading the latest saved records."
          : "Your unsaved draft was recovered after refresh. It has not been saved to your account. Review it, then choose Save to account."
      : "A recovery copy of your unsaved edits is kept in this browser tab. It survives refresh; it is not a cloud save. Closing the tab or clearing browser data can remove it. Keep regular JSON backups.");
  $("workspaceEditor").hidden = Boolean(pendingDraft);
  for (const id of ["importButton", "export"])
    $(id).disabled = Boolean(pendingDraft);
  $("loadDemo").disabled = saving || Boolean(pendingDraft);
  $("storageStatus").textContent = pendingDraft
    ? "Unsaved draft waiting — sign in to recover"
    : expired
    ? "Sign-in expired — edits remain on this page"
    : saving
      ? "Updating account records…"
      : dirty
        ? draftKept
          ? "Unsaved changes — recovery copy kept in this tab"
          : "Unsaved changes — held on this page only"
        : authenticated
          ? "Loaded records match the last confirmed cloud version"
          : "Fictional demo — held on this page only";
  const date = savedAt && new Date(savedAt);
  $("lastSaved").textContent =
    date && !Number.isNaN(date.getTime())
      ? "Last confirmed cloud save: " + date.toLocaleString("en-GB")
      : "No cloud save time available in this tab.";
  $("signIn").textContent =
    authenticated && !expired
      ? "My workspace"
      : expired
        ? "Sign in again"
        : "Sign in";
  $("signOut").hidden = !authenticated && !expired && !pendingDraft;
  $("delete").hidden = !authenticated || expired;
  $("save").hidden = expired;
  $("save").disabled = saving || conflict || !authenticated;
  $("resumeSignIn").hidden = !expired && !pendingDraft;
  $("resumeSignIn").textContent = pendingDraft
    ? "Sign in to recover my draft"
    : "Sign in again — keep my draft";
  $("resumeSignIn").disabled = saving;
}
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
function clearSaveFailure() {
  $("saveFailure").hidden = true;
}
function setConflict(value) {
  conflict = value;
  $("saveConflict").hidden = !value;
  $("save").disabled = saving || conflict || !authenticated;
  $("delete").disabled = saving || conflict;
}
function precondition() {
  if (revision === undefined) {
    setConflict(true);
    throw Error(
      "Load your saved records before saving. Your changes are still on this page; export a backup to keep them.",
    );
  }
  return revision === null
    ? { "If-None-Match": "*" }
    : { "If-Match": `"${revision}"` };
}
async function workspaceAction(fn) {
  if (saving) return;
  saving = true;
  updateStatus();
  for (const id of [
    "save",
    "delete",
    "loadLatest",
    "loadDemo",
    "signIn",
    "signOut",
  ])
    $(id).disabled = true;
  try {
    await fn();
  } catch (e) {
    if (e.status === 409 || e.status === 428) {
      setConflict(true);
      message(
        "Save stopped to protect your records. Your unsaved changes are still on this page.",
      );
    } else {
      message(e);
    }
  } finally {
    saving = false;
    for (const id of ["loadLatest", "loadDemo", "signIn", "signOut"])
      $(id).disabled = false;
    setConflict(conflict);
    updateStatus();
  }
}
async function account({ recoverOwner, started = changes } = {}) {
  if (!token) return;
  // Re-authentication checks ownership/revision without replacing tab memory.
  // This also protects edits made while the code or cloud read is in flight.
  const waiting = pendingDraft;
  recoverOwner = waiting?.ownerId || recoverOwner;
  const keepDraft = Boolean(recoverOwner);
  const session = token;
  const w = await (await api("workspace")).json();
  if (token !== session) return false;
  if (!keepDraft && started !== changes) {
    setConflict(true);
    throw Error(
      "You made more changes while records were loading. They are still on this page. Export a backup before trying again.",
    );
  }
  if (
    !Object.hasOwn(w, "revision") ||
    typeof w.ownerId !== "string" ||
    !w.ownerId
  )
    throw Error(
      "Saving protection is not ready. Keep this page open and export your changes.",
    );
  if (keepDraft && w.ownerId !== recoverOwner)
    throw Error(
      "Sign back in to the account that owns this draft. Your edits are still on this page; export a backup to keep them.",
    );
  if (waiting && started !== changes)
    throw Error("Your on-screen changes are still here. Export them before recovering the earlier draft.");
  const baseRevision = waiting ? waiting.revision : revision;
  const newerCloud = keepDraft && w.revision !== baseRevision;
  if (waiting) {
    planner.set(structuredClone(waiting.data));
    revision = waiting.revision;
    dirty = true;
    $("saveFailure").hidden = !waiting.failed;
    draftRecovered = true;
    pendingDraft = null;
  }
  if (!keepDraft) {
    planner.set(w.data);
    dirty = false;
    clearSaveFailure();
  }
  if (!newerCloud) revision = w.revision;
  ownerId = w.ownerId;
  authenticated = true;
  expired = false;
  savedAt = w.updated;
  setConflict(newerCloud);
  updateStatus();
  $("mode").textContent = config.privatePreview
    ? "PRIVATE PREVIEW · SAVE CHANGES"
    : "ACCOUNT RECORDS · SAVE CHANGES";
  $("accountStatus").textContent = config.privatePreview
    ? "Signed in to the private preview. Saving and exporting are available without payment. Use fictional records for testing; click Save to account after changes."
    : "Signed in. Your saved records have been loaded. Export is available without a subscription.";
  if (config.commerce) {
    const a = await (await api("account")).json();
    $("accountStatus").textContent +=
      " Monthly subscription: " +
      (a.monthly ? "active" : "inactive") +
      ". Download purchase: " +
      (a.download ? "available" : "not found") +
      ".";
  }
  message(
    keepDraft
      ? newerCloud
        ? "Signed in again. Your draft is preserved, but the cloud record has changed. Export your draft before loading the latest records."
        : dirty
          ? "Signed in again. Your unsaved draft is preserved. Review it, then choose Save to account."
          : "Signed in again. Your on-screen records are preserved. Choose Save to account to confirm a save."
      : "",
  );
  return true;
}
function routes() {
  const q = $("routeSearch").value.toLowerCase(),
    list = $("routesList");
  list.replaceChildren();
  for (const r of config.catalogue.filter((r) =>
    (r.name + " " + r.group + " " + r.note).toLowerCase().includes(q),
  )) {
    const card = el("article", undefined, "route-card");
    card.append(
      el("span", r.group.toUpperCase(), "tag"),
      el("h3", r.name),
      el("p", r.note),
      el(
        "small",
        r.coverage === "long-residence"
          ? "Absence indicators + evidence records"
          : "Evidence records · no eligibility calculation",
      ),
    );
    const a = el("a", "Read official guidance ↗");
    a.href = r.url;
    a.target = "_blank";
    a.rel = "noopener";
    const choose = el("button", "Use this route", "choose");
    choose.onclick = () => {
      $("route").value = r.id;
      $("route").dispatchEvent(new Event("change"));
      location.hash = "workspace";
    };
    card.append(a, choose);
    list.append(card);
  }
  if (!list.children.length)
    list.append(
      el(
        "p",
        "No matching entries. Try a broader term or consult the full Immigration Rules index.",
      ),
    );
}
async function action(fn) {
  try {
    await fn();
  } catch (e) {
    message(e);
  }
}
$("routeSearch").oninput = () => config && routes();
$("resumeSignIn").onclick = () => $("auth").showModal();
$("signIn").onclick = () => {
  if (authenticated && !expired) {
    location.hash = "workspace";
    return;
  }
  if (!config?.authReady)
    return message("Accounts are not connected yet. Use the fictional demo.");
  $("auth").showModal();
};
$("closeAuth").onclick = () => $("auth").close();
$("sendCode").onclick = async () => {
  try {
    await api("auth/otp", "POST", { email: $("email").value });
    $("authMessage").textContent = "Check your email for a sign-in code.";
  } catch (e) {
    $("authMessage").textContent = e.message;
  }
};
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  if (verifying || saving) return;
  verifying = true;
  const attempt = ++authAttempt;
  const oldToken = token;
  const recoverOwner = pendingDraft?.ownerId || ownerId;
  const started = changes;
  $("verifyCode").disabled = true;
  try {
    if (
      dirty &&
      !recoverOwner &&
      !confirm(
        "Load account records and replace the on-screen draft? Export a JSON backup first to keep your changes.",
      )
    )
      return;
    const a = await (
      await api("auth/otp", "POST", {
        email: $("email").value,
        token: $("code").value,
      })
    ).json();
    if (attempt !== authAttempt) return;
    if (!a.token) throw Error("No session returned.");
    token = a.token;
    if (!(await account({ recoverOwner, started })) || attempt !== authAttempt)
      return;
    try { sessionStorage.setItem("sp-session", token); } catch {
      // The in-memory session works; recovery availability is shown separately.
    }
    $("code").value = "";
    $("authMessage").textContent = "";
    $("auth").close();
  } catch (e) {
    if (attempt !== authAttempt) return;
    token = oldToken;
    updateStatus();
    $("authMessage").textContent = e.message;
  } finally {
    verifying = false;
    $("verifyCode").disabled = false;
  }
};
$("save").onclick = () =>
  workspaceAction(async () => {
    if (!token) throw Error("Sign in before saving.");
    if (conflict) return;
    const data = structuredClone(validateWorkspace(planner.get()));
    const started = changes;
    const headers = precondition();
    let saved;
    try {
      saved = await (await api("workspace", "POST", data, headers)).json();
      if (
        saved.saved !== true ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(saved.revision)
      )
        throw Error("The save acknowledgement is incomplete.");
    } catch (e) {
      if (e.status === 409 || e.status === 428) throw e;
      // Separate from routine edit/export messages; retain the draft and revision.
      $("saveFailure").hidden = false;
      message(e.status && e.status < 500 ? e : "");
      return;
    }
    revision = saved.revision;
    savedAt = saved.updated;
    dirty = started !== changes;
    expired = false;
    clearSaveFailure();
    draftStorageIssue = "";
    $("message").textContent =
      started === changes
        ? "Workspace saved to your account."
        : "Your earlier changes were saved. You have newer unsaved changes on this page.";
  });
$("loadLatest").onclick = () =>
  workspaceAction(async () => {
    if (!token) throw Error("Sign in before loading saved records.");
    if (
      !confirm(
        "Replace the unsaved records on this page with the latest saved records? Export a backup first to keep your changes.",
      )
    )
      return;
    if (await account())
      message(
        "Latest saved records loaded. Review them before making further changes.",
      );
  });
$("loadDemo").onclick = () => {
  if (
    confirm(
      "Replace on-screen records with the fictional example? Saved account records will not change.",
    )
  ) {
    changes++;
    dirty = true;
    planner.set(fictional());
    updateStatus();
    clearSaveFailure();
    $("mode").textContent = "FICTIONAL DEMO · NOT SAVED";
    message("Fictional demo loaded.");
  }
};
$("demoLink").onclick = () => {
  $("message").textContent =
    "The initial trip and permission are fictional. Explore the three tabs; nothing is saved automatically.";
};
$("signOut").onclick = () => {
  if (
    (dirty || pendingDraft) &&
    !confirm(
      "Sign out and discard unsaved edits on this page? Cancel and export a JSON backup first to keep them.",
    )
  )
    return;
  try { sessionStorage.removeItem(draftKey); } catch {
    message("This browser could not clear its draft copy. Clear this site's browser data before leaving a shared device.");
    return;
  }
  pendingDraft = null;
  draftKept = false;
  draftRecovered = false;
  draftStorageIssue = "";
  authAttempt++;
  changes++;
  dirty = false;
  authenticated = false;
  expired = false;
  ownerId = undefined;
  savedAt = null;
  token = "";
  revision = undefined;
  setConflict(false);
  try { sessionStorage.removeItem("sp-session"); } catch { /* Memory is cleared. */ }
  planner.set(fictional());
  clearSaveFailure();
  $("mode").textContent = "FICTIONAL DEMO · NOT SAVED";
  $("accountStatus").textContent =
    "Signed out. Account records are no longer on screen.";
  message("Signed out of this planner tab.");
  updateStatus();
};
$("delete").onclick = () =>
  workspaceAction(async () => {
    if (!token) throw Error("Sign in before deleting saved records.");
    const headers = precondition();
    if (
      !confirm(
        "Permanently delete the workspace saved in your account? Export first if you need a copy.",
      )
    )
      return;
    await api("workspace/delete", "POST", {}, headers);
    revision = null;
    setConflict(false);
    planner.set(emptyWorkspace());
    dirty = false;
    savedAt = null;
    clearSaveFailure();
    message(
      "Saved workspace deleted. Billing and account email remain; contact support for full account deletion.",
    );
  });
document.querySelectorAll("[data-buy]").forEach(
  (b) =>
    (b.onclick = () => {
      if (config?.privatePreview && b.dataset.buy === "monthly") {
        $("auth").showModal();
        return;
      }
      if (!config?.commerce) {
        $("commerceUnavailable").showModal();
        return;
      }
      if (!token) {
        $("auth").showModal();
        return;
      }
      product = b.dataset.buy;
      $("purchaseTitle").textContent =
        product === "monthly"
          ? "£1 per month · hosted workspace"
          : "£5 once · offline planner";
      $("purchaseText").textContent =
        product === "monthly"
          ? "Renews monthly until cancelled. Export remains available after cancellation. The offline download is a separate purchase."
          : "A standalone HTML planner to keep on your computer. No hosted subscription or guaranteed future updates included.";
      if (config.sandboxCheckout) {
        $("purchaseTitle").textContent = "SANDBOX TEST · " + $("purchaseTitle").textContent;
        $("purchaseText").textContent += " This is a simulated purchase. Use a Stripe test card; no real money will be taken and no purchase contract is created.";
      }
      $("acceptTermsText").textContent = config.sandboxCheckout
        ? " I understand this is a sandbox simulation using fictional details and a Stripe test card."
        : " I accept the purchase terms and recurring billing where selected.";
      $("acceptTerms").checked = false;
      $("checkoutMessage").textContent = "";
      $("purchase").showModal();
    }),
);
$("termsLink").onclick = () => $("purchase").close();
$("checkout").onclick = async () => {
  $("checkout").disabled = true;
  $("checkoutMessage").textContent = "Opening secure checkout…";
  try {
    if (!$("acceptTerms").checked)
      throw Error(config.sandboxCheckout
        ? "Please confirm that this is a sandbox simulation."
        : "Please review and accept the purchase terms.");
    const d = await (
      await api("checkout", "POST", { product, acceptTerms: true })
    ).json();
    location.assign(d.url);
  } catch (e) {
    $("checkoutMessage").textContent = e.message;
  } finally {
    $("checkout").disabled = false;
  }
};
$("portal").onclick = () =>
  action(async () => {
    const d = await (await api("portal", "POST", {})).json();
    location.assign(d.url);
  });
$("download").onclick = () =>
  action(async () => {
    const r = await api("download"),
      blob = await r.blob(),
      url = URL.createObjectURL(blob),
      a = el("a");
    a.href = url;
    a.download = "My-Settlement-Record.html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(
      "Purchased planner downloaded. Import your JSON backup into it to transfer records.",
    );
  });
updateStatus();
try {
  config = await (await api("config")).json();
  $("routeCount").textContent = String(config.catalogue.length);
  routes();
  $("accountStatus").textContent = config.authReady
    ? config.privatePreview
      ? "Private preview for invited testers. Sign in to save and reload fictional test records. Payments are disabled."
      : "Sign in to load your account records. The example below is fictional."
    : "Pre-launch demo. Accounts and payments are not connected. Do not enter real records in the demo.";
  $("portal").disabled = !config.commerce;
  $("download").disabled = !config.commerce;
  if (config.privatePreview) {
    $("hostedSummary").textContent = "Free private preview";
    $("hostedPrice").textContent = "Free private preview";
    $("plansIntro").textContent =
      "The private preview is free for invited testers. The £5 download is a planned paid option and cannot be purchased yet. The source code remains public and free to self-host.";
    document.querySelector('[data-buy="monthly"]').textContent = "Sign in to preview";
    $("hostedDescription").textContent =
      "Invited testers can save fictional records to their account and export a backup. Preview access is temporary. Payments are disabled; no subscription is created.";
    $("billingTerms").textContent =
      "The private preview is free for invited testers while enabled. It does not start a subscription or authorise future charges. Paid purchases are disabled. Export a backup before preview access ends.";
    $("dataHandling").textContent =
      "Preview account email and saved fictional records are stored in Supabase. Each invited account can access only its own workspace. Use fictional records and evidence references only. Export regular backups. No documents are uploaded and no payment details are collected. Full service and privacy information must be completed before public launch.";
    $("authHint").textContent =
      "Use the email address invited by the operator. Only invited, verified accounts can access the private preview.";
  }
  $("dataHandling").textContent +=
    " Unsaved account edits are also kept temporarily in this browser tab for refresh recovery when browser storage is available. This is not a cloud save or permanent backup. Signing out clears this copy; closing the tab or clearing browser data can remove it.";
  $("operator").textContent =
    "Operator: " +
    config.operator +
    (config.support
      ? " · Support: " + config.support
      : " · Support contact not configured.");
  $("launchState").textContent = config.privatePreview
    ? "Private preview — invited testers only. Payments are disabled. No payment will be taken."
    : config.sandboxCheckout
    ? "SANDBOX TEST ONLY — simulated payments. Published terms acceptance has not been tested."
    : config.commerce
    ? "Commerce enabled by operator. Read the published terms before purchasing."
    : "Pre-launch software — purchases disabled. No payment will be taken.";
  updateStatus();
  if (token) await account();
  if (new URLSearchParams(location.search).get("checkout") === "returned")
    message(
      "Checkout returned. Access is checked against Stripe payment status; a return page alone does not prove payment.",
    );
} catch (e) {
  message(e);
}
