export default function handler(req, res) {
  res.json({
    mcp_version: "1.0",
    tools: [{
      name: "getOrderDetails",
      input_schema: {
        type: "object",
        required: ["tenant","orderId","email"],
        properties: {
          tenant: { type: "string", enum: ["demo"] }, // dodasz kolejne: ["demo","shop2",...]
          orderId: { type: "string" },
          email: { type: "string", format: "email" }
        }
      }
    }]
  });
}
