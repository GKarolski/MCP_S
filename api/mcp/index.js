// api/mcp/index.js
export default function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = {
    mcp_version: '1.0',
    tools: [
      {
        name: 'getOrderDetails',
        description:
          'Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.',
        input_schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          additionalProperties: false,
          required: ['tenant', 'orderRef', 'email'],
          properties: {
            tenant: { type: 'string', enum: ['demo'] },
            orderRef: { type: 'string', description: 'ID lub numer zamówienia' },
            email: { type: 'string', format: 'email' },
          },
        },
      },
    ],
  };

  // HEAD – bez ciała
  if (req.method === 'HEAD') {
    res.status(200).end();
  } else {
    res.status(200).json(body);
  }
}
