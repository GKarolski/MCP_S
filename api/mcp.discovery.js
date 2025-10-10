export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    mcp_version: "1.0",
    tools: [{
      name: "getOrderDetails",
      description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
      input_schema: {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "additionalProperties": false,
        "required": ["tenant","orderRef","email"],
        "properties": {
          "tenant":  { "type": "string", "enum": ["demo"] },
          "orderRef":{ "type": "string", "description": "ID lub numer zamówienia" },
          "email":   { "type": "string", "format": "email" }
        }
      }
    }]
  });
}
