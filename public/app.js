import { mountPlanner, fictional, $, el } from "/planner.js";
import { emptyWorkspace, validateWorkspace } from "/domain.js";
let config,
  token = sessionStorage.getItem("sp-session") || "",
  product = "",
  revision,
  conflict = false,
  saving = false,
  changes = 0;
const planner = mountPlanner(fictional(), () => {
  changes++;
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
    throw error;
  }
  return r;
}
function message(e) {
  $("message").textContent = e.message || String(e);
}
function setConflict(value) {
  conflict = value;
  $("saveConflict").hidden = !value;
  $("save").disabled = saving || conflict;
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
  }
}
async function account() {
  if (!token) return;
  const started = changes;
  const session = token;
  const w = await (await api("workspace")).json();
  if (token !== session) return false;
  if (started !== changes) {
    setConflict(true);
    throw Error(
      "You made more changes while records were loading. They are still on this page. Export a backup before trying again.",
    );
  }
  if (!Object.hasOwn(w, "revision"))
    throw Error(
      "Saving protection is not ready. Keep this page open and export your changes.",
    );
  planner.set(w.data);
  revision = w.revision;
  setConflict(false);
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
  message("");
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
$("signIn").onclick = () => {
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
  try {
    if (
      !confirm(
        "Sign in and replace the on-screen demo with your account records? Export any changes first.",
      )
    )
      return;
    const a = await (
      await api("auth/otp", "POST", {
        email: $("email").value,
        token: $("code").value,
      })
    ).json();
    if (!a.token) throw Error("No session returned.");
    token = a.token;
    revision = undefined;
    sessionStorage.setItem("sp-session", token);
    await account();
    $("auth").close();
  } catch (e) {
    $("authMessage").textContent = e.message;
  }
};
$("save").onclick = () =>
  workspaceAction(async () => {
    if (!token) throw Error("Sign in before saving.");
    if (conflict) return;
    const data = structuredClone(validateWorkspace(planner.get()));
    const started = changes;
    const saved = await (
      await api("workspace", "POST", data, precondition())
    ).json();
    revision = saved.revision;
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
    planner.set(fictional());
    $("mode").textContent = "FICTIONAL DEMO · NOT SAVED";
    message("Fictional demo loaded.");
  }
};
$("demoLink").onclick = () => {
  $("message").textContent =
    "The initial trip and permission are fictional. Explore the three tabs; nothing is saved automatically.";
};
$("signOut").onclick = () => {
  changes++;
  token = "";
  revision = undefined;
  setConflict(false);
  sessionStorage.removeItem("sp-session");
  planner.set(fictional());
  $("mode").textContent = "FICTIONAL DEMO · NOT SAVED";
  $("accountStatus").textContent =
    "Signed out. Account records are no longer on screen.";
  message("Signed out of this planner tab.");
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
  if (token) await account();
  if (new URLSearchParams(location.search).get("checkout") === "returned")
    message(
      "Checkout returned. Access is checked against Stripe payment status; a return page alone does not prove payment.",
    );
} catch (e) {
  message(e);
}
