import express from "express";
import fetch from "node-fetch";
import { ClobClient, Side } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const PORT = process.env.PORT || 3000;

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const PRIVATE_KEY = must("PRIVATE_KEY");
const SERVICE_TOKEN = must("SERVICE_TOKEN");

// For most Polymarket users using MetaMask + proxy wallet, signature type is 2.
// (Docs also show signature type table and funder address instructions.) :contentReference[oaicite:6]{index=6}
const SIGNATURE_TYPE = Number(process.env.SIGNATURE_TYPE || "2");
const FUNDER_ADDRESS = process.env.FUNDER_ADDRESS || undefined;

// If you ever need a different API key “slot”, you can change nonce. :contentReference[oaicite:7]{index=7}
const API_KEY_NONCE = Number(process.env.API_KEY_NONCE || "0");

const signer = new Wallet(PRIVATE_KEY);
let client;

async function initClient() {
  const tempClient = new ClobClient(HOST, CHAIN_ID, signer);
  const apiCreds = await tempClient.createOrDeriveApiKey(API_KEY_NONCE);

  if (SIGNATURE_TYPE === 2 && !FUNDER_ADDRESS) {
    throw new Error(
      "SIGNATURE_TYPE=2 requires FUNDER_ADDRESS (your Polymarket Profile/Wallet address from polymarket.com/settings)."
    );
  }

  client = new ClobClient(HOST, CHAIN_ID, signer, apiCreds, SIGNATURE_TYPE, FUNDER_ADDRESS);
}

await initClient();

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    signerAddress: signer.address,
    signatureType: SIGNATURE_TYPE,
    hasFunder: Boolean(FUNDER_ADDRESS),
  });
});

// Check if THIS SERVER is geoblocked (important!)
app.get("/geoblock", async (req, res) => {
  const r = await fetch("https://polymarket.com/api/geoblock");
  const data = await r.json();
  res.json(data);
});

function auth(req, res, next) {
  const token = req.header("x-service-token");
  if (!token || token !== SERVICE_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

/**
 * POST /trade
 * Body for LIMIT order: { tokenID, side: "BUY", price, size, tickSize? }
 * Body for MARKET order: { tokenID, side: "BUY", amount, price?, tickSize? }
 *
 * - price is optional for market order (acts like a max price for BUY).
 * - tickSize must match the market (often "0.01"). :contentReference[oaicite:8]{index=8}
 */
app.post("/trade", auth, async (req, res) => {
  try {
    const { tokenID, side, price, size, amount, tickSize } = req.body || {};
    if (!tokenID) return res.status(400).json({ ok: false, error: "tokenID is required" });

    const sideEnum = String(side).toUpperCase() === "SELL" ? Side.SELL : Side.BUY;
    const options = { tickSize: String(tickSize || "0.01") };

    let resp;

    if (amount !== undefined && amount !== null) {
      // Market order: amount = dollars for BUY, shares for SELL (per docs). :contentReference[oaicite:9]{index=9}
      resp = await client.createAndPostMarketOrder(
        {
          tokenID,
          amount: Number(amount),
          side: sideEnum,
          price: price !== undefined && price !== null ? Number(price) : undefined
        },
        options
      );
    } else {
      if (price === undefined || size === undefined) {
        return res.status(400).json({
          ok: false,
          error: "For a LIMIT order provide price + size. For a MARKET order provide amount."
        });
      }

      resp = await client.createAndPostOrder(
        {
          tokenID,
          price: Number(price),
          size: Number(size),
          side: sideEnum
        },
        options
      );
    }

    res.json({ ok: true, resp });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`Order service listening on ${PORT}`));
