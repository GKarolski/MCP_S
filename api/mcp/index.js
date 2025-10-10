import { cors, parseBody, getTenantsFromEnv, buildToolDef, getOrderDetails } from './_shared.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const tenants = getTenantsFromEnv();
  const toolDef = buildToolDef(Object.keys(tenants));

  if (req.method === 'GET') {
    return res.status(200).json({ mcp_version: '1.0', tools: [toolDef] });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = parseBody(req);
  // POST /mcp:
  // - puste body => list_tools
  // - z {name, arguments} => call_tool (fallback)
  if (!body?.name) {
    return res.status(200).json({ tools: [toolDef] });
  }
  if (body.name !== 'getOrderDetails') {
    return res.status(400).json({ error: 'unknown_tool' });
  }
  try {
    const result = await getOrderDetails(body.arguments || {}, tenants);
    return res.status(200).json({ output: JSON.stringify({ result }) });
  } catch (e) {
    console.error('tool_failed', e);
    return res.status(500).json({ error: 'tool_failed', detail: e?.message || String(e) });
  }
}
