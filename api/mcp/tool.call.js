import { cors, parseBody, getTenantsFromEnv, getOrderDetails } from './_shared.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const tenants = getTenantsFromEnv();
  const body = parseBody(req);
  const name = body?.name || 'getOrderDetails';

  if (name !== 'getOrderDetails') return res.status(400).json({ error: 'unknown_tool' });

  try {
    const result = await getOrderDetails(body.arguments || {}, tenants);
    return res.status(200).json({ output: JSON.stringify({ result }) });
  } catch (e) {
    console.error('tool_failed', e);
    return res.status(500).json({ error: 'tool_failed', detail: e?.message || String(e) });
  }
}
