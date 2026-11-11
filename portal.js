"use strict";

const byId = id => document.getElementById(id);
const view = new URLSearchParams(location.search).get("view");
const admin = view === "admin";
const bucket = "portal-private-pdfs";
const money = new Intl.NumberFormat("en-IN", {style: "currency", currency: "INR"});
const statuses = ["unfulfilled", "processing", "dispatched", "delivered", "cancelled"];
const permissions = ["orders", "documents", "customers"];
const guestKey = "usoa-guest-cart-v1";
const products = new Map();
let client, session, profile, factorId;
let cart = new Map();

function status(message = "") {
  byId("portal-status").textContent = message;
}

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function button(label, action) {
  const node = element("button", label);
  node.type = "button";
  node.onclick = () => perform(node, action);
  return node;
}

async function perform(node, action) {
  node.disabled = true;
  status();
  try {
    await action();
  } catch (error) {
    status(error.message || "The request could not be completed.");
  } finally {
    node.disabled = false;
  }
}

function submit(id, action) {
  byId(id).addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    perform(form.querySelector("button:not([type=button])"), () => action(new FormData(form), form));
  });
}

async function result(request) {
  const {data, error} = await request;
  if (error) throw error;
  return data;
}

function show(...sections) {
  for (const id of ["login", "recovery", "mfa", "shop", "orders", "documents", "customers"]) {
    byId(id).hidden = !sections.includes(id);
  }
}

function guestCart() {
  try {
    return new Map(JSON.parse(localStorage.getItem(guestKey) || "[]").filter(([id, quantity]) =>
      typeof id === "string" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 100));
  } catch {
    return new Map();
  }
}

async function loadCart() {
  const guest = guestCart();
  cart = guest;
  if (!session) return;
  const saved = await result(client.from("portal_cart").select("product_id,quantity").eq("user_id", session.user.id));
  cart = new Map(saved.map(row => [row.product_id, row.quantity]));
  if (!guest.size) return;
  const additions = Array.from(guest, ([id, quantity]) => ({
    user_id: session.user.id, product_id: id, quantity: Math.max(cart.get(id) || 0, quantity)
  }));
  await result(client.from("portal_cart").upsert(additions));
  for (const row of additions) cart.set(row.product_id, row.quantity);
  localStorage.removeItem(guestKey);
}

async function setQuantity(id, quantity) {
  if (session) {
    const table = client.from("portal_cart");
    await result(quantity
      ? table.upsert({user_id: session.user.id, product_id: id, quantity})
      : table.delete().eq("user_id", session.user.id).eq("product_id", id));
  }
  if (quantity) cart.set(id, quantity);
  else cart.delete(id);
  if (!session) localStorage.setItem(guestKey, JSON.stringify([...cart]));
  renderCart();
}

function renderCart() {
  const rows = [];
  let total = 0;
  let unavailable = false;
  for (const [id, quantity] of cart) {
    const product = products.get(id);
    const row = element("div", "", "portal-row");
    row.append(element("strong", product?.name || "Unavailable product"));
    if (product) {
      total += product.amount * quantity;
      const input = element("input");
      input.type = "number";
      input.min = "1";
      input.max = "100";
      input.value = quantity;
      input.setAttribute("aria-label", "Quantity for " + product.name);
      input.onchange = () => input.reportValidity() && perform(input, () => setQuantity(id, input.valueAsNumber));
      row.append(input, element("span", money.format(product.amount * quantity)));
    } else unavailable = true;
    row.append(button("Remove", () => setQuantity(id, 0)));
    rows.push(row);
  }
  byId("cart-items").replaceChildren(...(rows.length ? rows : [element("p", "Your cart is empty.")]));
  byId("cart-total").textContent = rows.length ? money.format(total) : "";
  byId("cart-note").textContent = unavailable ? "Remove unavailable products to continue." : !session && rows.length ? "Sign in to check out." : "";
  byId("checkout-form").hidden = !session || !rows.length || unavailable;
}

function can(permission) {
  return profile.role === "owner" || profile.permissions.includes(permission);
}

async function renderOrders() {
  let query = client.from("portal_orders").select("id,items,amount,payment_status,fulfilment_status,created_at")
    .order("created_at", {ascending: false}).limit(100);
  if (!admin) query = query.eq("user_id", session.user.id);
  const rows = (await result(query)).map(order => {
    const row = element("div", "", "portal-row");
    row.append(element("strong", order.id + " · " + money.format(order.amount)),
      element("span", order.items.map(item => item.name + " × " + item.quantity).join(", ")),
      element("span", order.payment_status + " · " + order.fulfilment_status));
    if (admin) {
      const select = element("select");
      select.setAttribute("aria-label", "Fulfilment status for " + order.id);
      select.append(...statuses.map(value => new Option(value, value)));
      select.value = order.fulfilment_status;
      row.append(select, button("Update", async () => {
        await result(client.from("portal_orders").update({fulfilment_status: select.value}).eq("id", order.id).select("id").single());
        await renderOrders();
      }));
    }
    return row;
  });
  byId("order-items").replaceChildren(...(rows.length ? rows : [element("p", "No orders yet.")]));
}

async function renderDocuments() {
  let query = client.from("portal_documents").select("id,title,object_path,user_id").order("created_at", {ascending:false}).limit(100);
  if (!admin) query = query.eq("user_id", session.user.id);
  const rows = (await result(query)).map(doc => {
    const row = element("div", "", "portal-row");
    row.append(element("strong", doc.title), button("Download PDF", async () => {
      const file = await result(client.storage.from(bucket).download(doc.object_path));
      const url = URL.createObjectURL(file);
      const link = element("a");
      link.href = url;
      link.download = doc.title + ".pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    if (admin) row.append(button("Revoke access", async () => {
      await result(client.from("portal_documents").delete().eq("id", doc.id).select("id").single());
      await result(client.storage.from(bucket).remove([doc.object_path]));
      await renderDocuments();
    }));
    return row;
  });
  byId("document-items").replaceChildren(...(rows.length ? rows : [element("p", "No assigned documents.")]));
}

async function renderCustomers() {
  const rows = (await result(client.from("portal_profiles").select("user_id,display_name,role,permissions").limit(100))).map(person => {
    const row = element("div", "", "portal-row");
    row.append(element("strong", person.display_name || person.user_id), element("span", person.role));
    if (profile.role !== "owner" || person.role === "owner") return row;
    const role = element("select");
    role.setAttribute("aria-label", "Account role");
    role.append(new Option("Customer", "customer"), new Option("Staff", "staff"));
    role.value = person.role;
    const options = permissions.map(permission => {
      const label = element("label", permission);
      const check = element("input");
      check.type = "checkbox";
      check.checked = person.permissions.includes(permission);
      label.append(check);
      return {permission, label, check};
    });
    row.append(role, ...options.map(option => option.label), button("Save permissions", async () => {
      const selected = role.value === "staff" ? options.filter(option => option.check.checked).map(option => option.permission) : [];
      await result(client.from("portal_profiles").update({role: role.value, permissions: selected}).eq("user_id", person.user_id).select("user_id").single());
      await renderCustomers();
    }));
    return row;
  });
  byId("customer-items").replaceChildren(...rows);
}

async function openPortal() {
  session = (await result(client.auth.getSession())).session;
  byId("logout").hidden = !session;
  byId("portal-title").textContent = admin ? "Administration" : "Customer account";
  show(...(!admin ? ["shop"] : []), ...(!session ? ["login"] : []));
  if (!admin) {
    await loadCart();
    renderCart();
  }
  if (!session) return;
  profile = await result(client.from("portal_profiles").select("role,permissions").eq("user_id", session.user.id).maybeSingle());
  if (!profile) {
    await result(client.from("portal_profiles").insert({user_id: session.user.id, display_name: (session.user.email || "").slice(0, 100)}));
    profile = {role: "customer", permissions: []};
  }
  if (!admin) {
    show("shop", "orders", "documents");
    await Promise.all([renderOrders(), renderDocuments()]);
    return;
  }
  if (profile.role === "customer") {
    status("This account does not have admin access.");
    return;
  }
  const level = await result(client.auth.mfa.getAuthenticatorAssuranceLevel());
  if (level.currentLevel !== "aal2") {
    const factors = await result(client.auth.mfa.listFactors());
    factorId = factors.totp[0]?.id;
    if (!factorId) {
      for (const factor of factors.all.filter(item => item.factor_type === "totp" && item.status === "unverified")) {
        await result(client.auth.mfa.unenroll({factorId: factor.id}));
      }
      const factor = await result(client.auth.mfa.enroll({factorType: "totp", issuer: "USOA Group"}));
      factorId = factor.id;
      byId("mfa-qr").src = factor.totp.qr_code;
      byId("mfa-qr").hidden = false;
    }
    show("mfa");
    return;
  }
  show(...permissions.filter(can));
  byId("orders-title").textContent = "Customer orders";
  byId("documents-title").textContent = "Customer documents";
  byId("document-form").hidden = !can("documents");
  byId("invite-form").hidden = profile.role !== "owner";
  await Promise.all([can("orders") && renderOrders(), can("documents") && renderDocuments(), can("customers") && renderCustomers()]);
}

async function checkout(fields) {
  if (typeof window.Cashfree !== "function") {
    await new Promise((resolve, reject) => {
      const sdk = document.createElement("script");
      sdk.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      sdk.onload = resolve;
      sdk.onerror = () => reject(new Error("Payment service could not load. Please try again."));
      document.head.append(sdk);
    });
  }
  if (typeof window.Cashfree !== "function") throw new Error("Payment service could not start.");
  const response = await fetch("/api/portal/checkout", {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: "Bearer " + session.access_token},
    body: JSON.stringify({items: Array.from(cart, ([id, quantity]) => ({id, quantity})), customer: Object.fromEntries(fields)})
  });
  const order = await response.json();
  if (!response.ok || !order.payment_session_id) throw new Error(order.message || "Checkout is unavailable.");
  const gateway = window.Cashfree({mode: order.payment_environment});
  await gateway.checkout({paymentSessionId: order.payment_session_id, redirectTarget: "_self"});
}

async function start() {
  const catalogue = await fetch("/api/products").then(response => response.json()).catch(() => ({}));
  for (const product of catalogue.products || []) {
    products.set(product.id, product);
    const card = element("div", "", "portal-card");
    card.append(element("strong", product.name), element("span", money.format(product.amount)),
      button("Add to cart", () => setQuantity(product.id, Math.min(100, (cart.get(product.id) || 0) + 1))));
    byId("shop-items").append(card);
  }
  const response = await fetch("/api/portal/config");
  if (!response.ok) {
    if (!admin) { show("shop"); cart = guestCart(); renderCart(); }
    status("Account sign-in is being set up.");
    return;
  }
  const config = await response.json();
  const recovery = /(?:^|[&#])type=(?:invite|recovery)(?:&|$)/.test(location.hash);
  client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {storageKey: "usoa-portal-auth", detectSessionInUrl: true}
  });
  submit("login-form", async fields => {
    await result(client.auth.signInWithPassword(Object.fromEntries(fields)));
    byId("login-form").reset();
    await openPortal();
  });
  byId("reset").onclick = () => perform(byId("reset"), async () => {
    const email = byId("login-form").elements.email;
    if (!email.reportValidity()) return;
    await result(client.auth.resetPasswordForEmail(email.value, {redirectTo: location.origin + "/portal.html"}));
    status("If the address has an account, a reset email will arrive shortly.");
  });
  submit("recovery-form", async fields => {
    await result(client.auth.updateUser({password: fields.get("password")}));
    history.replaceState(null, "", location.pathname);
    await openPortal();
  });
  submit("mfa-form", async fields => {
    await result(client.auth.mfa.challengeAndVerify({factorId, code: fields.get("code")}));
    await openPortal();
  });
  submit("checkout-form", checkout);
  submit("invite-form", async (fields, form) => {
    const response = await fetch("/api/portal/invite", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + session.access_token},
      body: JSON.stringify(Object.fromEntries(fields))
    });
    const invitation = await response.json();
    if (!response.ok) throw new Error(invitation.message);
    form.reset();
    status("Invitation sent.");
  });
  submit("document-form", async (fields, form) => {
    const file = fields.get("file");
    if (file.size > 10485760 || file.size < 5 || await file.slice(0, 5).text() !== "%PDF-") throw new Error("Choose a PDF up to 10 MB.");
    const path = crypto.randomUUID() + ".pdf";
    await result(client.storage.from(bucket).upload(path, file, {contentType: "application/pdf"}));
    try {
      await result(client.from("portal_documents").insert({user_id: fields.get("customer").trim(), title: fields.get("title").trim(), object_path: path}));
    } catch (error) {
      await client.storage.from(bucket).remove([path]);
      throw error;
    }
    form.reset();
    await renderDocuments();
  });
  byId("logout").onclick = () => perform(byId("logout"), async () => {
    await result(client.auth.signOut());
    location.reload();
  });
  const initial = (await result(client.auth.getSession())).session;
  if (recovery && initial) {
    show("recovery");
    return;
  }
  client.auth.onAuthStateChange((event, nextSession) => {
    if (event === "TOKEN_REFRESHED") session = nextSession;
    if (event === "PASSWORD_RECOVERY") show("recovery");
  });
  await openPortal();
}

start().catch(error => status(error.message || "The portal is unavailable."));
