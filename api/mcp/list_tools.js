import { cors, getTenantsFromEnv, buildToolDef } from './_shared.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const tenants = getTenantsFromEnv();
  const toolDef = buildToolDef(Object.keys(tenants));
  return res.status(200).json({ tools: [toolDef] });
}
