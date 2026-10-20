import { mountPlanner, fictional, $, el } from "/planner.js";
import { emptyWorkspace, validateWorkspace } from "/domain.js";
let config,
  token = sessionStorage.getItem("sp-session") || "",
  product = "";
const planner = mountPlanner(fictional(), () => {
  $("message").textContent =
    "Changes on screen are unsaved. Export a backup or save to your account.";
});
async function api(path, method = "GET", data) {
  const r = await fetch("/api/" + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) {
    const d = await r.json();
    throw Error(d.error || "Request failed.");
  }
  return r;
}
function message(e) {
  $("message").textContent = e.message || String(e);
}
async function account() {
  if (!token) return;
  const w = await (await api("workspace")).json();
  planner.set(w.data);
  $("mode").textContent = "ACCOUNT RECORDS · SAVE CHANGES";
  $("accountStatus").textContent =
    "Signed in. Your saved records have been loaded. Export is available without a subscription.";
  if (config.commerce) {
    const a = await (await api("account")).json();
    $("accountStatus").textContent +=
      " Monthly subscription: " +
      (a.monthly ? "active" : "inactive") +
      ". Download purchase: " +
      (a.download ? "available" : "not found") +
      ".";
  }
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
    sessionStorage.setItem("sp-session", token);
    await account();
    $("auth").close();
  } catch (e) {
    $("authMessage").textContent = e.message;
  }
};
$("save").onclick = () =>
  action(async () => {
    if (!token) throw Error("Sign in before saving.");
    validateWorkspace(planner.get());
    await api("workspace", "POST", planner.get());
    $("message").textContent = "Workspace saved to your account.";
  });
$("loadDemo").onclick = () => {
  if (
    confirm(
      "Replace on-screen records with the fictional example? Saved account records will not change.",
    )
  ) {
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
  token = "";
  sessionStorage.removeItem("sp-session");
  planner.set(fictional());
  $("mode").textContent = "FICTIONAL DEMO · NOT SAVED";
  $("accountStatus").textContent =
    "Signed out. Account records are no longer on screen.";
  message("Signed out of this planner tab.");
};
$("delete").onclick = () =>
  action(async () => {
    if (
      !confirm(
        "Permanently delete the workspace saved in your account? Export first if you need a copy.",
      )
    )
      return;
    await api("workspace/delete", "POST", {});
    planner.set(emptyWorkspace());
    message(
      "Saved workspace deleted. Billing and account email remain; contact support for full account deletion.",
    );
  });
document.querySelectorAll("[data-buy]").forEach(
  (b) =>
    (b.onclick = () => {
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
    ? "Sign in to load your account records. The example below is fictional."
    : "Pre-launch demo. Accounts and payments are not connected. Do not enter real records in the demo.";
  $("operator").textContent =
    "Operator: " +
    config.operator +
    (config.support
      ? " · Support: " + config.support
      : " · Support contact not configured.");
  $("launchState").textContent = config.sandboxCheckout
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
