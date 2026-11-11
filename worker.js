import { handleInvoices } from './invoices.js';
import { handleDocuments, documentPage } from './documents-api.js';
const CASHFREE_API_VERSION = "2025-01-01";

const CASHFREE_SANDBOX = "https://sandbox.cashfree.com/pg";
const CASHFREE_PRODUCTION = "https://api.cashfree.com/pg";

const PRODUCTS = {
  honey500: {
    id: "honey500",
    name: "Natural Raw Honey - 500g",
    amount: 399
  },
  apisCeranaColony: {
    id: "apisCeranaColony",
    name: "Apis Cerana Bee Colonies",
    amount: 8000
  },
  beeHivesBoxes: {
    id: "beeHivesBoxes",
    name: "Bee Hives & Boxes",
    amount: 1000
  },
  honeyExtractor: {
    id: "honeyExtractor",
    name: "Honey Extractor",
    amount: 8000
  },
  beekeepingGloves: {
    id: "beekeepingGloves",
    name: "Beekeeping Gloves & Equipment",
    amount: 100
  },
  beeswax1kg: {
    id: "beeswax1kg",
    name: "Pure Beeswax - 1kg",
    amount: 699
  },
  beekeepingToolkits: {
    id: "beekeepingToolkits",
    name: "Beekeeping Toolkits (all)",
    amount: 8000
  },
  melipheraCeranaColony: {
    id: "melipheraCeranaColony",
    name: "Meliphera Cerana Bee Colonies",
    amount: 10000
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function cashfreeEnvironment(env) {
  const raw = String(env.CASHFREE_ENV || "").trim().toLowerCase();

  if (!raw) return "invalid";

  if (["sandbox", "test", "testing"].includes(raw)) {
    return "sandbox";
  }

  if (["production", "prod", "live"].includes(raw)) {
    return "production";
  }

  return "invalid";
}

function cashfreeBase(env) {
  const mode = cashfreeEnvironment(env);

  if (mode === "production") return CASHFREE_PRODUCTION;
  if (mode === "sandbox") return CASHFREE_SANDBOX;

  return null;
}

function credentialsConfigured(env) {
  return Boolean(
    String(env.CASHFREE_CLIENT_ID || "").trim() &&
    String(env.CASHFREE_CLIENT_SECRET || "").trim()
  );
}

function cashfreeHeaders(env, extra = {}) {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": String(env.CASHFREE_CLIENT_ID || "").trim(),
    "x-client-secret": String(env.CASHFREE_CLIENT_SECRET || "").trim(),
    ...extra
  };
}

function makeOrderId() {
  return `USOA_${Date.now()}_${crypto.randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
}

function makeCustomerId() {
  return `CUST_${crypto.randomUUID()
    .replaceAll("-", "")
    .slice(0, 20)}`;
}

function validPhone(phone) {
  return /^\d{10}$/.test(String(phone || ""));
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

async function createCashfreeOrder(request, env, data, account = null) {
  const environment = cashfreeEnvironment(env);

  if (environment === "invalid") {
    return jsonResponse({
      success: false,
      message: "CASHFREE_ENV must be sandbox or production."
    }, 500);
  }

  const product = Object.hasOwn(PRODUCTS, data?.productId) ? PRODUCTS[data.productId] : null;
  const items = account
    ? data.items.map(({id, quantity}) => ({id, quantity, name: PRODUCTS[id].name, unitPrice: PRODUCTS[id].amount}))
    : [];
  const orderAmount = account
    ? items.reduce((cents, item) => cents + Math.round(item.unitPrice * 100) * item.quantity, 0) / 100
    : product?.amount;
  const orderName = account ? "USOA Group cart" : product?.name;

  if (!orderAmount) {
    return jsonResponse({
      success: false,
      message: "Invalid product."
    }, 400);
  }

  const customer = data?.customer || {};

  const name = String(customer.name || "")
    .trim()
    .slice(0, 100);

  const email = String(account?.email || customer.email || "")
    .trim()
    .toLowerCase();

  const phone = String(customer.phone || "")
    .replace(/\D/g, "");

  if (name.length < 2) {
    return jsonResponse({
      success: false,
      message: "Enter a valid name."
    }, 400);
  }

  if (!validEmail(email)) {
    return jsonResponse({
      success: false,
      message: "Enter a valid email address."
    }, 400);
  }

  if (!validPhone(phone)) {
    return jsonResponse({
      success: false,
      message: "Enter a valid 10-digit mobile number."
    }, 400);
  }

  const origin = new URL(request.url).origin;
  const orderId = account ? makeOrderId().replace("USOA_", "USOA_PORTAL_") : makeOrderId();
  if (account) {
    await portalOrders(env, "", {
      method: "POST",
      body: JSON.stringify({id: orderId, user_id: account.id, items, amount: orderAmount})
    });
  }

  const payload = {
    order_id: orderId,
    order_amount: orderAmount,
    order_currency: "INR",

    customer_details: {
      customer_id: makeCustomerId(),
      customer_name: name,
      customer_email: email,
      customer_phone: phone
    },

    order_meta: {
      return_url:
        `${origin}/payment-success.html?order_id=${encodeURIComponent(orderId)}`,

      notify_url:
        `${origin}/api/cashfree-webhook`
    },

    order_note: orderName,

    order_tags: {
      product_id: account ? "portal-cart" : product.id,
      product_name: orderName
    }
  };

  const response = await fetch(
    `${cashfreeBase(env)}/orders`,
    {
      method: "POST",

      headers: cashfreeHeaders(env, {
        "x-request-id": crypto.randomUUID(),
        "x-idempotency-key": crypto.randomUUID()
      }),

      body: JSON.stringify(payload)
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      "Cashfree create order failed",
      response.status,
      result
    );

    const upstreamMessage = String(
      result?.message || "Unable to create Cashfree order."
    );
    const authRelated =
      response.status === 401 ||
      response.status === 403 ||
      /authenticat|credential|client.?id|client.?secret/i.test(upstreamMessage);

    return jsonResponse({
      success: false,
      message: authRelated
        ? `Cashfree rejected the API credentials for the ${cashfreeEnvironment(env)} environment. Confirm CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET, and CASHFREE_ENV all belong to the same environment. (HTTP ${response.status})`
        : `${upstreamMessage} (HTTP ${response.status})`,
      error_code: result?.code || result?.type || null,
      cashfree_http_status: response.status
    }, 502);
  }

  return jsonResponse({
    success: true,
    order_id: result.order_id,
    payment_session_id: result.payment_session_id,
    product: orderName,
    amount: orderAmount,
    payment_environment: environment
  });
}

async function portalOrders(env, query, options) {
  const key = env.PORTAL_SUPABASE_SECRET_KEY;
  if (!key || !env.PORTAL_SUPABASE_URL) throw new Error("Portal order storage is unavailable");
  const response = await fetch(env.PORTAL_SUPABASE_URL + "/rest/v1/portal_orders" + query, {
    ...options,
    headers: {apikey: key, "Content-Type": "application/json"}
  });
  if (!response.ok) throw new Error("Portal order storage failed");
}

async function portalCheckout(request, env) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return jsonResponse({message: "Invalid origin."}, 403);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({message: "Sign in to check out."}, 401);
  if (!env.PORTAL_SUPABASE_URL || !env.PORTAL_SUPABASE_PUBLISHABLE_KEY || !credentialsConfigured(env)) {
    return jsonResponse({message: "Portal checkout is not configured."}, 503);
  }
  const auth = await fetch(env.PORTAL_SUPABASE_URL + "/auth/v1/user", {
    headers: {apikey: env.PORTAL_SUPABASE_PUBLISHABLE_KEY, Authorization: authorization}
  });
  if (!auth.ok) return jsonResponse({message: "Sign in again to check out."}, 401);
  const account = await auth.json();
  if (!account.id || !account.email_confirmed_at || !account.email) return jsonResponse({message: "Verify your email before checkout."}, 403);
  const data = await request.json();
  const items = data?.items;
  if (!Array.isArray(items) || !items.length || items.length > 30 ||
      items.some(item => !item || typeof item.id !== "string" || !Object.hasOwn(PRODUCTS, item.id) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) ||
      new Set(items.map(item => item.id)).size !== items.length) {
    return jsonResponse({message: "Review the products and quantities in your cart."}, 400);
  }
  return createCashfreeOrder(request, env, data, account);
}

async function portalInvite(request, env) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== origin) return jsonResponse({message: "Invalid origin."}, 403);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({message: "Sign in as owner."}, 401);
  const key = env.PORTAL_SUPABASE_SECRET_KEY;
  const base = env.PORTAL_SUPABASE_URL;
  if (!key || !base || !env.PORTAL_SUPABASE_PUBLISHABLE_KEY) return jsonResponse({message: "Invitations are not configured."}, 503);
  const permission = await fetch(base + "/rest/v1/rpc/portal_can_invite", {
    method: "POST",
    headers: {apikey: env.PORTAL_SUPABASE_PUBLISHABLE_KEY, Authorization: authorization, "Content-Type": "application/json"},
    body: "{}"
  });
  if (!permission.ok || await permission.json() !== true) return jsonResponse({message: "Owner access and authenticator verification are required."}, 403);
  const body = await request.json();
  const email = String(body?.email || "").trim().toLowerCase();
  if (email.length > 254 || !validEmail(email)) return jsonResponse({message: "Enter a valid email."}, 400);
  const invite = await fetch(base + "/auth/v1/invite?redirect_to=" + encodeURIComponent(origin + "/portal.html"), {
    method: "POST",
    headers: {apikey: key, "Content-Type": "application/json"},
    body: JSON.stringify({email})
  });
  if (!invite.ok) return jsonResponse({message: "Could not send the invite. Check whether the account already exists and email delivery is configured."}, 502);
  return jsonResponse({success: true});
}

async function getOrderStatus(env, orderId) {
  const response = await fetch(
    `${cashfreeBase(env)}/orders/${encodeURIComponent(orderId)}`,
    {
      method: "GET",

      headers: cashfreeHeaders(env, {
        "x-request-id": crypto.randomUUID()
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  return {
    response,
    data
  };
}

async function verifyWebhookSignature(
  rawBody,
  timestamp,
  signature,
  secret
) {
  if (!timestamp || !signature || !secret) {
    return false;
  }

  const payload = `${timestamp}${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  const binary = String.fromCharCode(
    ...new Uint8Array(digest)
  );

  const expected = btoa(binary);

  return expected === signature;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const portalViews = {"/login": "", "/account": "", "/cart": "?view=cart", "/admin": "?view=admin", "/admin/login": "?view=admin"};
    if (request.method === "GET" && Object.hasOwn(portalViews, url.pathname)) {
      return Response.redirect(url.origin + "/portal.html" + portalViews[url.pathname], 302);
    }
    if (url.pathname === "/api/portal/config" && request.method === "GET") {
      if (!env.PORTAL_SUPABASE_URL || !env.PORTAL_SUPABASE_PUBLISHABLE_KEY) return jsonResponse({message: "Portal setup is pending."}, 503);
      return jsonResponse({
        url: env.PORTAL_SUPABASE_URL,
        publishableKey: env.PORTAL_SUPABASE_PUBLISHABLE_KEY,
        paymentEnvironment: cashfreeEnvironment(env)
      });
    }
    if (url.pathname === "/api/portal/checkout" && request.method === "POST") {
      try {
        return await portalCheckout(request, env);
      } catch {
        return jsonResponse({message: "Could not start checkout. Please try again."}, 503);
      }
    }
    if (url.pathname === "/api/portal/invite" && request.method === "POST") {
      try {
        return await portalInvite(request, env);
      } catch {
        return jsonResponse({message: "Could not send the invite."}, 503);
      }
    }
    if (url.pathname.startsWith('/api/documents/')) return handleDocuments(request, env);
    const page = documentPage(request, env);
    if (page) return page;

    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }


    // Safe configuration check. Add ?verify=1 for a read-only Cashfree auth probe.
    if (
      url.pathname === "/api/test" &&
      request.method === "GET"
    ) {
      const environment = cashfreeEnvironment(env);
      const configured = credentialsConfigured(env);
      const result = {
        success: true,
        provider: "Cashfree",
        environment,
        api_base: cashfreeBase(env),
        credentials_configured: configured,
        authentication_check: "not_run"
      };

      if (url.searchParams.get("verify") === "1") {
        if (environment === "invalid") {
          result.authentication_check = "invalid_environment_setting";
        } else if (!configured) {
          result.authentication_check = "credentials_missing";
        } else {
          try {
            const response = await fetch(
              `${cashfreeBase(env)}/orders/USOA_DIAGNOSTIC_ORDER_NOT_REAL_20261014`,
              {
                method: "GET",
                headers: cashfreeHeaders(env, {
                  "x-request-id": crypto.randomUUID()
                })
              }
            );

            const detail = await response.json().catch(() => ({}));
            result.cashfree_http_status = response.status;
            result.cashfree_code = detail?.code || detail?.type || null;
            result.cashfree_message = detail?.message || null;

            if (response.status === 401 || response.status === 403) {
              result.authentication_check = "rejected";
            } else if (response.status === 404) {
              result.authentication_check = "likely_ok_order_not_found";
            } else if (response.ok) {
              result.authentication_check = "passed";
            } else {
              result.authentication_check = "indeterminate";
            }
          } catch (error) {
            console.error("Cashfree auth diagnostic failed", error);
            result.authentication_check = "network_error";
          }
        }
      }

      return jsonResponse(result);
    }

    // Products API
    if (
      url.pathname === "/api/products" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        success: true,
        products: Object.values(PRODUCTS)
      });
    }

    // Create Cashfree Order
    if (
      url.pathname === "/api/create-order" &&
      request.method === "POST"
    ) {
      if (!credentialsConfigured(env)) {
        return jsonResponse({
          success: false,
          message:
            "Cashfree credentials are not configured."
        }, 500);
      }

      try {
        const data = await request.json();

        return await createCashfreeOrder(
          request,
          env,
          data
        );

      } catch (error) {
        console.error(
          "Create order error",
          error
        );

        return jsonResponse({
          success: false,
          message:
            "Invalid request or payment service error."
        }, 500);
      }
    }

    // Check Order Status
    if (
      url.pathname === "/api/order-status" &&
      request.method === "GET"
    ) {
      if (cashfreeEnvironment(env) === "invalid") {
        return jsonResponse({
          success: false,
          message: "CASHFREE_ENV must be sandbox or production."
        }, 500);
      }

      if (!credentialsConfigured(env)) {
        return jsonResponse({
          success: false,
          message:
            "Cashfree credentials are not configured."
        }, 500);
      }

      const orderId =
        url.searchParams.get("order_id");

      if (
        !orderId ||
        !/^USOA_[A-Za-z0-9_]+$/.test(orderId)
      ) {
        return jsonResponse({
          success: false,
          message: "Invalid order_id."
        }, 400);
      }

      try {
        const {
          response,
          data
        } = await getOrderStatus(
          env,
          orderId
        );

        if (!response.ok) {
          return jsonResponse({
            success: false,
            message:
              data?.message ||
              "Unable to fetch order status."
          }, 502);
        }

        return jsonResponse({
          success: true,
          order_id: orderId,
          order_status:
            data.order_status || "UNKNOWN",
          order_amount:
            data.order_amount,
          order_currency:
            data.order_currency
        });

      } catch (error) {
        console.error(
          "Order status error",
          error
        );

        return jsonResponse({
          success: false,
          message:
            "Unable to verify payment status."
        }, 502);
      }
    }

    // Cashfree Webhook
    if (
      url.pathname === "/api/cashfree-webhook" &&
      request.method === "POST"
    ) {
      if (!credentialsConfigured(env)) {
        return jsonResponse({
          success: false,
          message:
            "Webhook is not configured."
        }, 500);
      }

      const rawBody =
        await request.text();

      const timestamp =
        request.headers.get(
          "x-webhook-timestamp"
        );

      const signature =
        request.headers.get(
          "x-webhook-signature"
        );

      const valid =
        await verifyWebhookSignature(
          rawBody,
          timestamp,
          signature,
          String(env.CASHFREE_CLIENT_SECRET || "").trim()
        );

      if (!valid) {
        return jsonResponse({
          success: false,
          message:
            "Invalid webhook signature."
        }, 401);
      }

      try {
        const event =
          JSON.parse(rawBody);

        const orderId = event?.data?.order?.order_id;
        if (env.PORTAL_SUPABASE_SECRET_KEY && typeof orderId === "string" && /^USOA_PORTAL_[A-Za-z0-9_]+$/.test(orderId) &&
            event?.data?.payment?.payment_status === "SUCCESS") {
          try {
            await portalOrders(env, "?id=eq." + encodeURIComponent(orderId), {
              method: "PATCH",
              body: JSON.stringify({payment_status: "PAID"})
            });
          } catch {
            return jsonResponse({message: "Payment update could not be saved."}, 503);
          }
        }

        console.log(
          "Verified Cashfree webhook",
          JSON.stringify({
            type: event?.type,
            order_id:
              event?.data?.order?.order_id,
            status:
              event?.data?.payment
                ?.payment_status
          })
        );

      } catch (error) {
        console.error(
          "Webhook JSON error",
          error
        );
      }

      return jsonResponse({
        success: true
      });
    }

    // Supabase access is restricted to this authenticated server endpoint.
    if (url.pathname === '/api/invoices') return handleInvoices(request, env);

    // Static website
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Not Found",
      { status: 404 }
    );
  }
};


