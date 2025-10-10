function setCors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
}

const tools = [
  {
    name: "getOrderDetails",
    description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
    input_schema: {
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res, 'GET,OPTIONS,HEAD');
    res.status(204).end();
    return;
  }
  if (req.method === 'HEAD') {
    setCors(res, 'GET,OPTIONS,HEAD');
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    setCors(res, 'GET,OPTIONS,HEAD');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  setCors(res, 'GET,OPTIONS,HEAD');
  res.status(200).json({
    // <<< to jest kluczowe dla zgodności z backendem OpenAI
    mcp: { version: "1.0" },
    tools
  });
}
