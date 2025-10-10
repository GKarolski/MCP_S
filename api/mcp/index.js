// api/mcp/index.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",
    "Content-Type, Authorization, OpenAI-Organization, OpenAI-Project, Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { id, method, params } = body || {};
    const jsonrpc = "2.0";

    // <<< TWOJE NARZĘDZIA >>>
    const tools = [
      {
        name: "roll",
        description: "Roll dice. Example: 2d4+1",
        inputSchema: {                    // UWAGA: camelCase!
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { diceRollExpression: { type: "string" } },
          required: ["diceRollExpression"],
          additionalProperties: false
        }
      }
      // dodaj kolejne narzędzia tutaj
    ];

    let result;

    if (method === "initialize") {
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mcp-s-eight", version: "1.0.0" }
      };
    } else if (method === "tools/list") {
      result = { tools };
    } else if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      if (name === "roll") {
        // prosta implementacja przykładowego toola
        result = { content: [{ type: "text", text: `rolled: ${args?.diceRollExpression || ""}` }], isError: false };
      } else {
        return res.status(200).json({ jsonrpc, id, error: { code: -32601, message: "Unknown tool" } });
      }
    } else {
      return res.status(200).json({ jsonrpc, id, error: { code: -32601, message: "Method not found" } });
    }

    return res.status(200).json({ jsonrpc, id, result });
  } catch (e) {
    console.error("MCP error", e, req.body);
    return res.status(200).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: e.message } });
  }
}
