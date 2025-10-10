export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const tool = {
    name: 'get_order_details',
    description: 'Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.',
    input_schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['tenant','orderRef','email'],
      properties: {
        tenant: { type: 'string', enum: ['demo'] },
        orderRef: { type: 'string', description: 'ID lub numer zamówienia' },
        email: { type: 'string', format: 'email' }
      }
    }
  };

  res.status(200).json({ mcp_version: '1.0', tools: [tool] });
}
