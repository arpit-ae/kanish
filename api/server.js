import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

const CASHFREE_API_VERSION = "2025-01-01";


app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "USOA GROUP Cashfree API is running"
  });
});


app.post("/api/create-order", async (req, res) => {
  try {
    const { productId, customer } = req.body;

    const products = {
      honey500: {
        name: "Natural Raw Honey - 500g",
        amount: 399
      },

      beeswax1kg: {
        name: "Pure Beeswax - 1kg",
        amount: 699
      }
    };

    const product = products[productId];

    if (!product) {
      return res.status(400).json({
        success: false,
        message: "Invalid product"
      });
    }

    if (!process.env.CASHFREE_CLIENT_ID ||
        !process.env.CASHFREE_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Cashfree API credentials are not configured"
      });
    }

    const orderId =
      `USOA_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const customerId =
      `customer_${Date.now()}`;

    const response = await fetch(
      `${CASHFREE_BASE_URL}/orders`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-api-version": CASHFREE_API_VERSION,
          "x-client-id": process.env.CASHFREE_CLIENT_ID,
          "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
          "x-idempotency-key": randomUUID()
        },

        body: JSON.stringify({
          order_id: orderId,

          order_amount: product.amount,

          order_currency: "INR",

          customer_details: {
            customer_id: customerId,
            customer_name: customer?.name || "USOA Customer",
            customer_email: customer?.email || "customer@example.com",
            customer_phone: customer?.phone || "9999999999"
          },

          order_meta: {
            return_url:
              `${process.env.SITE_URL}/payment-success.html?order_id=${orderId}`
          },

          order_note: product.name
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Cashfree error:", data);

      return res.status(response.status).json({
        success: false,
        message: data.message || "Cashfree order creation failed",
        error: data
      });
    }

    return res.json({
      success: true,
      order_id: data.order_id,
      payment_session_id: data.payment_session_id,
      product: product.name,
      amount: product.amount
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});


export default app;
