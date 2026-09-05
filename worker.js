const PAYTM_ENVIRONMENT = "https://securegw.paytm.in";
const PAYTM_WEBSITE = "DEFAULT";
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
   VERIFY PAYTM CHECKSUM
   Decrypt AES-128-CBC → last 4 chars = salt →
   SHA256(decryptedMinusSalt + "|" + salt) should match.
========================================================= */

async function verifyPaytmChecksum(
  checksum,
  merchantKey
) {

  const keyBytes =
    new TextEncoder().encode(merchantKey);

  const ivBytes =
    new TextEncoder().encode(PAYTM_IV);

  if (keyBytes.length !== 16) {
    return false;
  }

  try {

    const cryptoKey =
      await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );

    const decrypted =
      await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: ivBytes },
        cryptoKey,
        Uint8Array.from(
          atob(checksum),
          c => c.charCodeAt(0)
        )
      );

    const decryptedText =
      new TextDecoder().decode(decrypted);

    const salt =
      decryptedText.slice(-4);

    const hashPart =
      decryptedText.slice(0, -4);

    const expected =
      await sha256Hex(
        `${hashPart}|${salt}`
      );

    return hashPart === expected;

  } catch {

    return false;
  }
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
       Paytm POSTs here after payment. We verify by calling
       the Transaction Status API and checking the checksum.
       Always return 200 so Paytm does not retry.
    ===================================================== */

    if (
      url.pathname === "/api/callback"
    ) {

      try {

        if (
          !env.PAYTM_MID ||
          !env.PAYTM_MERCHANT_KEY
        ) {

          console.error(
            "Callback: Paytm runtime configuration missing"
          );

          return jsonResponse(
            {
              success: false,
              message:
                "Payment backend not configured"
            },
            200
          );
        }

        /* -----------------------------------------------
           PARSE CALLBACK BODY
        ------------------------------------------------ */

        let callbackData;

        try {

          callbackData =
            await request.json();

        } catch {

          return jsonResponse(
            {
              success: false,
              message:
                "Invalid callback payload"
            },
            200
          );
        }

        const orderId =
          callbackData?.ORDERID ||
          callbackData?.orderId;

        if (!orderId) {

          return jsonResponse(
            {
              success: false,
              message:
                "No orderId in callback"
            },
            200
          );
        }

        /* -----------------------------------------------
           CALL PAYTM TRANSACTION STATUS API
        ------------------------------------------------ */

        const statusBody = {
          mid: env.PAYTM_MID,
          orderId: orderId
        };

        const statusBodyString =
          JSON.stringify(statusBody);

        const statusChecksum =
          await generatePaytmChecksum(
            statusBodyString,
            env.PAYTM_MERCHANT_KEY
          );

        const statusUrl =
          `${PAYTM_ENVIRONMENT}` +
          `/theia/api/v1/getTxnStatus` +
          `?mid=${encodeURIComponent(env.PAYTM_MID)}` +
          `&orderId=${encodeURIComponent(orderId)}`;

        const statusResponse =
          await fetch(
            statusUrl,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                "Accept":
                  "application/json"
              },
              body:
                JSON.stringify({
                  body: statusBody,
                  head: {
                    signature:
                      statusChecksum
                  }
                })
            }
          );

        const statusText =
          await statusResponse.text();

        let statusResult;

        try {

          statusResult =
            JSON.parse(statusText);

        } catch {

          console.error(
            "Callback: Paytm returned invalid JSON:",
            statusText
          );

          return jsonResponse(
            {
              success: false,
              message:
                "Could not verify payment",
              orderId: orderId
            },
            200
          );
        }

        /* -----------------------------------------------
           VERIFY CHECKSUM
        ------------------------------------------------ */

        const returnedChecksum =
          statusResult?.head?.signature;

        let checksumValid = false;

        if (returnedChecksum) {

          checksumValid =
            await verifyPaytmChecksum(
              returnedChecksum,
              env.PAYTM_MERCHANT_KEY
            );
        }

        /* -----------------------------------------------
           EXTRACT RESULT
        ------------------------------------------------ */

        const body =
          statusResult?.body;

        const resultInfo =
          body?.resultInfo;

        const resultStatus =
          resultInfo?.resultStatus;

        const resultCode =
          resultInfo?.resultCode;

        const resultMsg =
          resultInfo?.resultMsg;

        const txnAmount =
          body?.txnAmount;

        const bankTxnId =
          body?.bankTxnId;

        console.log(
          "Payment callback:",
          JSON.stringify({
            orderId: orderId,
            resultStatus: resultStatus,
            resultCode: resultCode,
            resultMsg: resultMsg,
            checksumValid: checksumValid
          })
        );

        /* -----------------------------------------------
           DETERMINE OUTCOME
        ------------------------------------------------ */

        if (
          checksumValid &&
          resultStatus === "TXN_SUCCESS"
        ) {

          return jsonResponse({
            success: true,
            orderId: orderId,
            amount: txnAmount || null,
            bankTxnId: bankTxnId || null,
            message:
              "Payment verified successfully"
          });
        }

        if (resultStatus === "PENDING") {

          return jsonResponse({
            success: false,
            orderId: orderId,
            status: "PENDING",
            message:
              resultMsg ||
              "Payment is pending"
          });
        }

        return jsonResponse({
          success: false,
          orderId: orderId,
          status: resultStatus || "UNKNOWN",
          resultCode: resultCode || null,
          message:
            resultMsg ||
            "Payment was not successful"
        });

      } catch (error) {

        console.error(
          "Callback error:",
          error?.message || String(error)
        );

        return jsonResponse(
          {
            success: false,
            message:
              "Error processing payment callback"
          },
          200
        );
      }
    }

    /* =====================================================
       EXISTING WEBSITE
    ===================================================== */

    if (
      url.pathname === "/"
    ) {

      const homeUrl =
        new URL(
          "/index.html",
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
