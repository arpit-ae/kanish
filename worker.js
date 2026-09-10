const CASHFREE_API_VERSION = "2025-01-01";

const CASHFREE_SANDBOX = "https://sandbox.cashfree.com/pg";
const CASHFREE_PRODUCTION = "https://api.cashfree.com/pg";

const PRODUCTS = {
  honey500: {
    id: "honey500",
    name: "Natural Raw Honey - 500g",
    amount: 399
  },
  beeswax1kg: {
    id: "beeswax1kg",
    name: "Pure Beeswax - 1kg",
    amount: 699
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

function cashfreeBase(env) {
  return env.CASHFREE_ENV === "production"
    ? CASHFREE_PRODUCTION
    : CASHFREE_SANDBOX;
}

function credentialsConfigured(env) {
  return Boolean(
    env.CASHFREE_CLIENT_ID &&
    env.CASHFREE_CLIENT_SECRET
  );
}

function cashfreeHeaders(env, extra = {}) {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-version": CASHFREE_API_VERSION,
    "x-client-id": env.CASHFREE_CLIENT_ID,
    "x-client-secret": env.CASHFREE_CLIENT_SECRET,
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

async function createCashfreeOrder(request, env, data) {
  const product = PRODUCTS[data?.productId];

  if (!product) {
    return jsonResponse({
      success: false,
      message: "Invalid product."
    }, 400);
  }

  const customer = data?.customer || {};

  const name = String(customer.name || "")
    .trim()
    .slice(0, 100);

  const email = String(customer.email || "")
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
  const orderId = makeOrderId();

  const payload = {
    order_id: orderId,
    order_amount: product.amount,
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

    order_note: product.name,

    order_tags: {
      product_id: product.id,
      product_name: product.name
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

    return jsonResponse({
      success: false,
      message:
        result?.message ||
        "Unable to create Cashfree order."
    }, 502);
  }

  return jsonResponse({
    success: true,
    order_id: result.order_id,
    payment_session_id: result.payment_session_id,
    product: product.name,
    amount: product.amount
  });
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

    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    // Test API
    if (
      url.pathname === "/api/test" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        success: true,
        provider: "Cashfree",

        environment:
          env.CASHFREE_ENV === "production"
            ? "production"
            : "sandbox",

        credentials_configured:
          credentialsConfigured(env)
      });
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
          env.CASHFREE_CLIENT_SECRET
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
