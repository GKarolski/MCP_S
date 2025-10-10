import { VercelRequest, VercelResponse } from "@vercel/node";
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({
    mcp_version: "1.0",
    tools: [{
      name: "getOrderDetails",
      input_schema: {
        type: "object",
        required: ["tenant","orderId","email"],
        properties: {
          tenant: { type: "string", enum: ["demo"] },
          orderId: { type: "string" },
          email: { type: "string", format: "email" }
        }
      }
    }]
  });
}
