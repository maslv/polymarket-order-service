import express from "express";
import { ClobClient, Side } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const app = express();
app.use(express.json());

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const {
  PRIVATE_KEY,
  FUNDER_ADDRESS,
  SIGNATURE_TYPE = "2",
  ORDER_SERVICE_KEY,
  PORT = "3000",
} = process.env;

if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
if (!FUNDER_ADDRESS) throw new Error("Missing FUNDER_ADDRESS");
if (!ORDER_SERVICE_KEY) throw new Error("Missing ORDER_SERVICE_KEY");

let clientPromise = initClient();

async function initClient() {
  // Polymarket quickstart: create client + createOrDeriveApiKey(), then trade. :contentReference[oaicite:4]{index=4}
  const signer = new Wallet(PRIVATE_KEY);
  const tempClient = new ClobClient(HOST, CHAIN_ID, signer);
  const apiCreds = await tempClient.createOrDeriveApiKey();

  // Polymarket L2 methods: initialize with signer + api creds + signatureType + funder. :contentReference[oaicite:5]{index=5}
  return new ClobClient(HOST, CHAIN_ID, signer, apiCreds, Number(SIGNATURE_TYPE), FUNDER_ADDRESS);
}

function authed(req) {
  return req.headers["x-order-service-key"] === ORDER_SERVICE_KEY;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/order", async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: "Unauthorized" });

  const { tokenID, price, size, side = "BUY" } = req.body || {};
  if (!tokenID) return res.status(400).json({ error: "tokenID required" });
  if (price === undefined) return res.status(400).json({ error: "price required" });
  if (size === undefined) return res.status(400).json({ error: "size required" });

  const client = await clientPromise;

  const resp = await client.createAndPostOrder({
    tokenID,
    price: Number(price),
    size: Number(size),
    side: String(side).toUpperCase() === "SELL" ? Side.SELL : Side.BUY,
  });

  res.json(resp);
});

app.listen(Number(PORT), () => console.log("Listening on", PORT));
