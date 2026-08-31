export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Backend test
    if (url.pathname === "/api/test") {
      return Response.json({
        success: true,
        message: "USOA GROUP payment backend is working"
      });
    }

    // Create Paytm transaction
    if (url.pathname === "/api/create-order" && request.method === "POST") {
      try {
        const data = await request.json();
        const amount = Number(data.amount);

        // Basic validation
        if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
          return Response.json(
            { success: false, message: "Invalid payment amount" },
            { status: 400 }
          );
        }

        const orderId =
          "USOA_" +
          Date.now() +
          "_" +
          crypto.randomUUID().slice(0, 8);

        const customerId = "CUST_" + crypto.randomUUID().slice(0, 12);

        const body = {
          requestType: "Payment",
          mid: env.PAYTM_MID,
          websiteName: "WEBSTAGING",
          orderId: orderId,
          callbackUrl: `${url.origin}/api/callback`,
          txnAmount: {
            value: amount.toFixed(2),
            currency: "INR"
          },
          userInfo: {
            custId: customerId
          }
        };

        // TODO:
        // Paytm checksum/signature will be added in the next step.

        return Response.json({
          success: true,
          message: "Order data prepared",
          orderId,
          amount: amount.toFixed(2),
          body
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            message: "Unable to create order"
          },
          { status: 500 }
        );
      }
    }

    // Existing website
    return env.ASSETS.fetch(request);
  }
};
