// api/mcp/index.js
export default function handler(req, res) {
  const payload = {
    mcp_version: "1.0",
    capabilities: { tools: { list_changed: true } },
    tools: [{
      name: "getOrderDetails",
      description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
      input_schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        required: ["tenant","orderRef","email"],
        properties: {
          tenant: { type: "string", enum: ["demo"] },
          orderRef: { type: "string", description: "ID lub numer zamówienia" },
          email: { type: "string", format: "email" }
        }
      }
    }]
  };

  const ok = () => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
  };

  if (req.method === "OPTIONS") { ok(); return res.status(204).end(); }
  if (req.method === "HEAD")    { ok(); return res.status(200).end(); }
  if (req.method === "GET" || req.method === "POST") {
    ok(); return res.status(200).json(payload);
  }
  res.setHeader("Allow", "GET,POST,HEAD,OPTIONS");
  return res.status(405).end();
}
