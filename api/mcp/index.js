// api/mcp/index.js

export default async function handler(req, res) {
  // CORS (nie jest krytyczne dla serwer→serwer, ale nie szkodzi)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const discovery = {
    mcp_version: '1.0',
    tools: [
      {
        name: 'get_order_details',    
        description: 'Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.',
        input_schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          additionalProperties: false,
          required: ['tenant', 'orderRef', 'email'],
          properties: {
            tenant: { type: 'string', enum: ['demo'] },
            orderRef: { type: 'string', description: 'ID lub numer zamówienia' },
            email: { type: 'string', format: 'email' }
          }
        }
      }
    ]
  };

  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Discovery powinno być szybkie i statyczne
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.status(200).send(JSON.stringify(discovery));
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}
