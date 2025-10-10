function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
const tools = [{
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
}];

export default function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });
  res.setHeader("Content-Type","application/json");
  res.status(200).json({ tools });
}
