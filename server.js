app.get("/debug/apikey", async (req, res) => {
  try {
    const { ClobClient } = require("@polymarket/clob-client");
    const { Wallet } = require("ethers");

    const HOST = "https://clob.polymarket.com";
    const CHAIN_ID = 137;

    const signer = new Wallet(process.env.PRIVATE_KEY);
    const client = new ClobClient(HOST, CHAIN_ID, signer);

    const nonceEnv = process.env.API_KEY_NONCE;
    const nonce = (nonceEnv === undefined || nonceEnv === "") ? undefined : Number(nonceEnv);

    // If a key exists, this should succeed
    await client.deriveApiKey(nonce);

    res.json({ ok: true, message: "deriveApiKey succeeded" });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: "deriveApiKey failed",
      // this often includes the real reason (invalid sig, etc)
      error: e?.response?.data || e?.message || String(e),
    });
  }
});
