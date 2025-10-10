export default function handler(req, res) {
  res.json({
    mcp_version: "1.0",
    tools: [{
      name: "getOrderDetails",
      input_schema: {
        type: "object",
        required: ["tenant","orderRef","email"],
        properties: {
          tenant: { type: "string", enum: ["demo"] },
          orderRef: { type: "string", description: "ID lub numer zamówienia" },
          email: { type: "string", format: "email" }
        }
      }
    }]
  });
}
