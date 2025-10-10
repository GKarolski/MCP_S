export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const { name } = req.body || {};
  if (name !== "getOrderDetails") return res.status(400).json({ error: "unknown_tool" });
  res.json({ result: { ok: true, demo: true } });
}
