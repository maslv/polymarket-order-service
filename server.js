import express from "express";
import fetch from "node-fetch";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

// DigitalOcean App Platform expects your app to listen on port 8080
// (they set PORT=8080 automatically). :contentReference[oaicite:0]{index=0}
const PORT = Number(process.env.PORT || 8080);

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const SIGNATURE_TYPE = Number(process.env.SIGNATURE_TYPE || "2");
const FUNDER_ADDRESS = process.env.FUNDER_ADDRESS;

// Nonce used for API key derivation. Default 0 per docs. :contentReference[oaicite:1]{index=1}
const API_KEY_NONCE = Number(process.env.API_KEY_NONCE || "0");

if (!PRIVATE_KEY) throw new Error("Missing env var PRIVATE_KEY");
if (!SERVICE_TOKEN) throw new Error("Missing env var SERVICE_TOKEN");

const signer = new Wallet(PRIVATE_KEY);

const app = express();
app.use(express.json({ limit: "1mb" }));

let l2Client = null;
let lastInitError = null;

async function initClient() {
  try {
    // L1 client: create or derive API creds (required before trading). :contentReference[oaicite:2]{index=2}
    const l1 = new ClobClient(HOST, CHAIN_ID, signer);

    // Try to derive first (helps if nonce already used), else create/derive. :contentReference[oaicite:3]{index=3}
    let apiCreds;
    try {
      apiCreds = await l1.deriveApiKey(API_KEY_NONCE);
    } catch (_e) {
      apiCreds = await l1.createOrDeriveApiKey();
    }

    // signatureType + funder rules from docs. :contentReference[oaicite:4]{index=4}
    const funder =
      SIGNATURE_TYPE === 0 ? signer.address : (FUNDER_ADDRESS || "");

    if (SIGNATURE_TYPE !== 0 && !FUNDER_ADDRESS) {
      throw new Error(
        "Missing FUNDER_ADDRESS. For signatureType 1 or 2, set FUNDER_ADDRESS to your Polymarket Profile/Wallet address."
      );
    }

    l2Client = new ClobClient(
      HOST,
      CHAIN_ID,
      signer,
      apiCreds,
      SIGNATURE_TYPE,
      funder
    );

    lastInitError = null;
  } catch (e) {
    l2Client = null;
    lastInitError = e;
    console.error(
      "[INIT ERROR]",
      e?.response?.data || e?.message || String(e)
    );
  }
}

// Try once at startup
await initClient();

// ---------- Auth helper ----------
function requireToken(req, res, next) {
  if (req.header("x-service-token") !== SERVICE_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ---------- Routes ----------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    signerAddress: signer.address,
    signatureType: SIGNATURE_TYPE,
    hasFunder: Boolean(FUNDER_ADDRESS),
    clientReady: Boolean(l2Client),
    lastInitError: lastInitError
      ? (lastInitError?.response?.data || lastInitError?.message || String(lastInitError))
      : null,
  });
});

// Check if the SERVER IP is geoblocked
app.get("/geoblock", async (_req, res) => {
  const r = await fetch("https://polymarket.com/api/geoblock");
  const data = await r.json();
  res.json(data);
});

// Debug API key creation/derivation (no secrets returned)
app.get("/debug/apikey", async (_req, res) => {
  try {
    const l1 = new ClobClient(HOST, CHAIN_ID, signer);

    // Derive with this nonce (useful if NONCE_ALREADY_USED). :contentReference[oaicite:5]{index=5}
    const creds = await l1.deriveApiKey(API_KEY_NONCE);

    res.json({
      ok: true,
      message: "deriveApiKey succeeded",
      nonce: API_KEY_NONCE,
      apiKeyPrefix: String(creds?.apiKey || "").slice(0, 8),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: "deriveApiKey failed",
      nonce: API_KEY_NONCE,
      error: e?.response?.data || e?.message || String(e),
    });
  }
});

// Place an order (limit) or market order
app.post("/trade", requireToken, async (req, res) => {
  try {
    // If client isn't ready, try init again on-demand
    if (!l2Client) await initClient();
    if (!l2Client) {
      return res.status(500).json({
        ok: false,
        error: "Client not initialized",
        details: lastInitError?.response?.data || lastInitError?.message || String(lastInitError),
      });
    }

    const { tokenID, side = "BUY", price, size, amount, tickSize = "0.01", negRisk = false } = req.body || {};
    if (!tokenID) return res.status(400).json({ ok: false, error: "tokenID required" });

    const sideEnum = String(side).toUpperCase() === "SELL" ? Side.SELL : Side.BUY;

    let resp;
    if (amount !== undefined && amount !== null) {
      // Market order is supported by the client. :contentReference[oaicite:6]{index=6}
      resp = await l2Client.createAndPostMarketOrder(
        { tokenID, amount: Number(amount), side: sideEnum, price: price !== undefined ? Number(price) : undefined },
        { tickSize: String(tickSize), negRisk: Boolean(negRisk) },
        OrderType.FAK
      );
    } else {
      if (price === undefined || size === undefined) {
        return res.status(400).json({ ok: false, error: "For LIMIT order provide price + size (or use amount for market order)" });
      }

      // Limit order convenience method. :contentReference[oaicite:7]{index=7}
      resp = await l2Client.createAndPostOrder(
        { tokenID, price: Number(price), size: Number(size), side: sideEnum },
        { tickSize: String(tickSize), negRisk: Boolean(negRisk) },
        OrderType.GTC
      );
    }

    res.json({ ok: true, resp });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e?.response?.data || e?.message || String(e),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Order service listening on ${PORT}`);
});
