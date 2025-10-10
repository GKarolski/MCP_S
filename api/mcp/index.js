// api/mcp/index.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",
    "Content-Type, Authorization, OpenAI-Organization, OpenAI-Project, Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const send = (id, result) => res.status(200).json({ jsonrpc: "2.0", id, result });
  const sendErr = (id, code, message) =>
    res.status(200).json({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    const { id, method, params } = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // === DEFINICJE NARZĘDZI (UWAGA: inputSchema w camelCase) ===
    const tools = [
      {
        name: "roll",
        description: "Roll dice. Example: 2d4+1",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { diceRollExpression: { type: "string" } },
          required: ["diceRollExpression"],
          additionalProperties: false
        }
      },
      {
        name: "getOrderDetails",
        description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          required: ["tenant", "orderRef", "email"],
          properties: {
            tenant: { type: "string", enum: ["demo"] },
            orderRef: { type: "string", description: "ID lub numer zamówienia" },
            email: { type: "string", format: "email" }
          }
        }
      }
    ];

    if (method === "initialize") {
      return send(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mcp-s-eight", version: "1.1.0" }
      });
    }

    if (method === "tools/list") return send(id, { tools });

    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};

      if (name === "roll") {
        return send(id, {
          content: [{ type: "text", text: `rolled: ${args?.diceRollExpression || ""}` }],
          isError: false
        });
      }

      if (name === "getOrderDetails") {
        const { tenant, orderRef, email } = args;
        if (!tenant || !orderRef || !email) {
          return sendErr(id, -32602, "tenant, orderRef i email są wymagane");
        }

        // PROSTA PROXY KORZYSTAJĄCA Z ISTNIEJĄCEJ LOGIKI (Twoje działające REST /api/mcp.tool.call)
        const base = `https://${req.headers.host}`;
        const r = await fetch(`${base}/api/mcp.tool.call`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "getOrderDetails",
            arguments: { tenant, orderRef: String(orderRef), email }
          })
        });

        if (!r.ok) return sendErr(id, -32000, `Upstream error ${r.status}`);
        const data = await r.json();

        return send(id, {
          content: [{ type: "json", json: data }],
          isError: false
        });
      }

      return sendErr(id, -32601, "Unknown tool");
    }

    return sendErr(id, -32601, "Method not found");
  } catch (e) {
    console.error("MCP error", e);
    return res.status(200).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: e.message } });
  }
}
