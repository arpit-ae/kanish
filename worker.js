const PAYTM_ENVIRONMENT = "https://securegw-stage.paytm.in";
const PAYTM_WEBSITE = "WEBSTAGING";
const PAYTM_IV = "@@@@&&&&####$$$$";

const PAYTM_SALT_CHARS =
  "9876543210ZYXWVUTSRQPONMLKJIHGFEDCBAabcdefghijklmnopqrstuvwxyz!@#$&_";

/* =========================================================
   BASIC RESPONSE
========================================================= */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

/* =========================================================
   BASE64
========================================================= */

function toBase64(bytes) {
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/* =========================================================
   SHA-256
========================================================= */

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);

  const digest = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(digest))
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

/* =========================================================
   PAYTM SALT
   Paytm uses a 4-character salt.
========================================================= */

function generateSalt() {
  const randomBytes = new Uint8Array(4);

  crypto.getRandomValues(randomBytes);

  let salt = "";

  for (const byte of randomBytes) {
    salt += PAYTM_SALT_CHARS[
      byte % PAYTM_SALT_CHARS.length
    ];
  }

  return salt;
}

/* =========================================================
   PAYTM CHECKSUM
   SHA256(params + "|" + salt)
   then hash + salt
   then AES-128-CBC
========================================================= */

async function generatePaytmChecksum(
  paramsString,
  merchantKey
) {
  if (!merchantKey) {
    throw new Error(
      "PAYTM_MERCHANT_KEY is missing"
    );
  }

  const keyBytes =
    new TextEncoder().encode(merchantKey);

  const ivBytes =
    new TextEncoder().encode(PAYTM_IV);

  /*
   * Paytm Merchant Key is AES-128 key.
   * Normally it is 16 bytes.
   */
  if (keyBytes.length !== 16) {
    throw new Error(
      `PAYTM_MERCHANT_KEY must be exactly 16 bytes. Received ${keyBytes.length} bytes.`
    );
  }

  const salt = generateSalt();

  const hash = await sha256Hex(
    `${paramsString}|${salt}`
  );

  const hashString =
    `${hash}${salt}`;

  const cryptoKey =
    await crypto.subtle.importKey(
      "raw",
      keyBytes,
      {
        name: "AES-CBC"
      },
      false,
      ["encrypt"]
    );

  const encrypted =
    await crypto.subtle.encrypt(
      {
        name: "AES-CBC",
        iv: ivBytes
      },
      cryptoKey,
      new TextEncoder().encode(hashString)
    );

  return toBase64(
    new Uint8Array(encrypted)
  );
}

/* =========================================================
   MAIN WORKER
========================================================= */

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    /* =====================================================
       BACKEND TEST
    ===================================================== */

    if (
      url.pathname === "/api/test"
    ) {
      return jsonResponse({
        success: true,
        message:
          "USOA GROUP payment backend is working"
      });
    }

    /* =====================================================
       CREATE PAYTM ORDER
    ===================================================== */

    if (
      url.pathname === "/api/create-order" &&
      request.method === "POST"
    ) {

      try {

        /* -----------------------------------------------
           CHECK RUNTIME SECRETS
        ------------------------------------------------ */

        if (
          !env.PAYTM_MID ||
          !env.PAYTM_MERCHANT_KEY
        ) {

          return jsonResponse(
            {
              success: false,
              message:
                "Paytm runtime configuration is missing"
            },
            500
          );
        }

        /* -----------------------------------------------
           READ REQUEST
        ------------------------------------------------ */

        let data;

        try {

          data =
            await request.json();

        } catch {

          return jsonResponse(
            {
              success: false,
              message:
                "Invalid JSON request"
            },
            400
          );
        }

        /* -----------------------------------------------
           AMOUNT
        ------------------------------------------------ */

        const amountNumber =
          Number(data?.amount);

        if (
          !Number.isFinite(amountNumber) ||
          amountNumber < 1 ||
          amountNumber > 1000000
        ) {

          return jsonResponse(
            {
              success: false,
              message:
                "Enter amount between ₹1 and ₹10,00,000"
            },
            400
          );
        }

        const amount =
          amountNumber.toFixed(2);

        /* -----------------------------------------------
           ORDER ID
        ------------------------------------------------ */

        const orderId =
          `USOA_${Date.now()}_${crypto
            .randomUUID()
            .replaceAll("-", "")
            .slice(0, 12)}`;

        /* -----------------------------------------------
           CUSTOMER ID
        ------------------------------------------------ */

        const customerId =
          `CUST_${crypto
            .randomUUID()
            .replaceAll("-", "")
            .slice(0, 16)}`;

        /* -----------------------------------------------
           CALLBACK URL
        ------------------------------------------------ */

        const callbackUrl =
          `${url.origin}/api/callback`;

        /* -----------------------------------------------
           PAYTM BODY
        ------------------------------------------------ */

        const body = {

          requestType: "Payment",

          mid: env.PAYTM_MID,

          websiteName:
            PAYTM_WEBSITE,

          orderId:
            orderId,

          callbackUrl:
            callbackUrl,

          txnAmount: {

            value:
              amount,

            currency:
              "INR"
          },

          userInfo: {

            custId:
              customerId
          }
        };

        /*
         * IMPORTANT:
         * Paytm's official Payment Initiation examples
         * generate checksum from body.toString().
         */
        const bodyString =
          JSON.stringify(body);

        /* -----------------------------------------------
           GENERATE CHECKSUM
        ------------------------------------------------ */

        const checksum =
          await generatePaytmChecksum(
            bodyString,
            env.PAYTM_MERCHANT_KEY
          );

        /* -----------------------------------------------
           PAYTM REQUEST
        ------------------------------------------------ */

        const paytmRequest = {

          body:

            body,

          head: {

            signature:
              checksum
          }
        };

        /* -----------------------------------------------
           PAYTM STAGING URL
        ------------------------------------------------ */

        const paytmUrl =
          `${PAYTM_ENVIRONMENT}` +
          `/theia/api/v1/initiateTransaction` +
          `?mid=${encodeURIComponent(
            env.PAYTM_MID
          )}` +
          `&orderId=${encodeURIComponent(
            orderId
          )}`;

        /* -----------------------------------------------
           CALL PAYTM
        ------------------------------------------------ */

        const paytmResponse =
          await fetch(
            paytmUrl,
            {

              method:
                "POST",

              headers: {

                "Content-Type":
                  "application/json",

                "Accept":
                  "application/json"
              },

              body:
                JSON.stringify(
                  paytmRequest
                )
            }
          );

        /* -----------------------------------------------
           READ RESPONSE
        ------------------------------------------------ */

        const responseText =
          await paytmResponse.text();

        let result;

        try {

          result =
            JSON.parse(
              responseText
            );

        } catch {

          console.error(
            "Paytm non-JSON response:",
            responseText
          );

          return jsonResponse(
            {
              success: false,
              message:
                "Paytm returned an invalid response",
              httpStatus:
                paytmResponse.status
            },
            502
          );
        }

        /* -----------------------------------------------
           PAYTM RESULT INFO
        ------------------------------------------------ */

        const resultInfo =
          result?.body?.resultInfo;

        const resultStatus =
          resultInfo?.resultStatus;

        const resultCode =
          resultInfo?.resultCode;

        const resultMsg =
          resultInfo?.resultMsg;

        const txnToken =
          result?.body?.txnToken;

        /* -----------------------------------------------
           LOG SAFE INFORMATION
           NEVER LOG MERCHANT KEY OR CHECKSUM
        ------------------------------------------------ */

        console.log(
          "Paytm response:",
          JSON.stringify({
            httpStatus:
              paytmResponse.status,

            resultStatus:
              resultStatus,

            resultCode:
              resultCode,

            resultMsg:
              resultMsg,

            orderId:
              orderId
          })
        );

        /* -----------------------------------------------
           FAILURE
        ------------------------------------------------ */

        if (
          !paytmResponse.ok ||
          !txnToken ||
          resultStatus !== "S"
        ) {

          return jsonResponse(
            {
              success: false,

              message:
                resultMsg ||
                "Paytm could not create transaction",

              resultCode:
                resultCode || null,

              resultStatus:
                resultStatus || null,

              orderId:
                orderId
            },
            502
          );
        }

        /* -----------------------------------------------
           SUCCESS
        ------------------------------------------------ */

        return jsonResponse(
          {
            success:
              true,

            orderId:
              orderId,

            amount:
              amount,

            mid:
              env.PAYTM_MID,

            txnToken:
              txnToken
          }
        );

      } catch (error) {

        console.error(
          "Paytm create-order error:",
          error?.message ||
          String(error)
        );

        return jsonResponse(
          {
            success: false,

            message:
              error?.message ||
              "Unable to start payment"
          },
          500
        );
      }
    }

    /* =====================================================
       PAYTM CALLBACK
       Verification will be implemented next.
    ===================================================== */

    if (
      url.pathname === "/api/callback"
    ) {

      return jsonResponse(
        {
          success: false,
          message:
            "Payment callback verification is not configured yet"
        },
        501
      );
    }

    /* =====================================================
       EXISTING WEBSITE
    ===================================================== */

    if (
      url.pathname === "/"
    ) {

      const homeUrl =
        new URL(
          "/Index.html",
          request.url
        );

      return env.ASSETS.fetch(
        new Request(
          homeUrl,
          request
        )
      );
    }

    return env.ASSETS.fetch(
      request
    );
  }
};
