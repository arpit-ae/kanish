const PAYTM_ENVIRONMENT = "https://securegw-stage.paytm.in";
const PAYTM_WEBSITE = "WEBSTAGING";
const PAYTM_IV = "@@@@&&&&####$$$$";

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function generateSalt() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

async function generatePaytmChecksum(paramsString, merchantKey) {
  const salt = await generateSalt();

  const hash = await sha256Hex(
    `${paramsString}|${salt}`
  );

  const hashString = `${hash}${salt}`;

  const keyBytes = new TextEncoder().encode(merchantKey);
  const ivBytes = new TextEncoder().encode(PAYTM_IV);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-CBC",
      iv: ivBytes
    },
    cryptoKey,
    new TextEncoder().encode(hashString)
  );

  return toBase64(new Uint8Array(encrypted));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Backend test
    if (url.pathname === "/api/test") {
      return jsonResponse({
        success: true,
        message: "USOA GROUP payment backend is working"
      });
    }

    // CREATE PAYTM ORDER
    if (
      url.pathname === "/api/create-order" &&
      request.method === "POST"
    ) {
      try {
        if (
          !env.PAYTM_MID ||
          !env.PAYTM_MERCHANT_KEY
        ) {
          return jsonResponse({
            success: false,
            message: "Paytm configuration is missing"
          }, 500);
        }

        const data = await request.json();

        const amountNumber = Number(data.amount);

        if (
          !Number.isFinite(amountNumber) ||
          amountNumber < 1 ||
          amountNumber > 1000000
        ) {
          return jsonResponse({
            success: false,
            message: "Enter amount between ₹1 and ₹10,00,000"
          }, 400);
        }

        const amount = amountNumber.toFixed(2);

        const orderId =
          `USOA_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

        const customerId =
          `CUST_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

        const body = {
          requestType: "Payment",
          mid: env.PAYTM_MID,
          websiteName: PAYTM_WEBSITE,
          orderId: orderId,

          callbackUrl:
            `${url.origin}/api/callback`,

          txnAmount: {
            value: amount,
            currency: "INR"
          },

          userInfo: {
            custId: customerId
          }
        };

        const bodyString =
          JSON.stringify(body);

        const signature =
          await generatePaytmChecksum(
            bodyString,
            env.PAYTM_MERCHANT_KEY
          );

        const paytmRequest = {
          body: body,

          head: {
            signature: signature
          }
        };

        const paytmUrl =
          `${PAYTM_ENVIRONMENT}` +
          `/theia/api/v1/initiateTransaction` +
          `?mid=${encodeURIComponent(env.PAYTM_MID)}` +
          `&orderId=${encodeURIComponent(orderId)}`;

        const paytmResponse =
          await fetch(paytmUrl, {
            method: "POST",

            headers: {
              "Content-Type": "application/json"
            },

            body: JSON.stringify(paytmRequest)
          });

        const responseText =
          await paytmResponse.text();

        let result;

        try {
          result = JSON.parse(responseText);
        } catch {
          return jsonResponse({
            success: false,
            message: "Invalid response from Paytm"
          }, 502);
        }

        const resultInfo =
          result?.body?.resultInfo;

        const txnToken =
          result?.body?.txnToken;

        if (
          !paytmResponse.ok ||
          !txnToken ||
          resultInfo?.resultStatus !== "S"
        ) {
          return jsonResponse({
            success: false,
            message:
              resultInfo?.resultMsg ||
              "Paytm could not create transaction"
          }, 502);
        }

        return jsonResponse({
          success: true,
          orderId: orderId,
          amount: amount,
          txnToken: txnToken,
          mid: env.PAYTM_MID
        });

      } catch (error) {

        console.error(
          "Paytm error:",
          error
        );

        return jsonResponse({
          success: false,
          message: "Unable to start payment"
        }, 500);
      }
    }

    // Callback — next step
    if (url.pathname === "/api/callback") {
      return jsonResponse({
        success: false,
        message: "Callback verification will be added next"
      }, 501);
    }

    // Existing website
    if (url.pathname === "/") {
  const homeUrl = new URL("/Index.html", request.url);
  return env.ASSETS.fetch(new Request(homeUrl, request));
}

return env.ASSETS.fetch(request);
  }
};
