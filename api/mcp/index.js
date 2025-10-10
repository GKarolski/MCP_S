// api/mcp/index.js

const send = (res, code, obj) => {
  res.status(code).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
};
const cors = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'content-type,authorization,openai-mcp-action,x-openai-mcp-action');
};

const TOOLS = [
  {
    name: 'getOrderDetails',
    description: 'Pobiera szczegóły zamówienia z WooCommerce (tenant + orderRef + email).',
    input_schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        tenant: { type: 'string' },
        orderRef: { type: 'string' },
        email: { type: 'string', format: 'email' }
      },
      required: ['tenant', 'orderRef', 'email'],
      additionalProperties: false
    }
  }
];

// ---- Woo helpers ----
const getTenantCfg = (tenantRaw) => {
  const T = String(tenantRaw || '').trim().toUpperCase();
  const baseUrl = process.env[`WOO_${T}_URL`];
  const key     = process.env[`WOO_${T}_KEY`];
  const secret  = process.env[`WOO_${T}_SECRET`];
  if (!baseUrl || !key || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), key, secret };
};
const sum = (arr, pick) => arr.reduce((a, it) => a + (parseFloat(pick(it) || '0') || 0), 0);
const asMoney = (n) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

async function getOrderDetails({ tenant, orderRef, email }) {
  const cfg = getTenantCfg(tenant);
  if (!cfg) return { ok: false, error: 'config_missing', message: `Brak env dla '${tenant}'.` };

  const qs = new URLSearchParams({
    consumer_key: cfg.key,
    consumer_secret: cfg.secret,
    per_page: '20',
    search: String(orderRef)
  });

  const list = await fetch(`${cfg.baseUrl}/wp-json/wc/v3/orders?${qs}`);
  if (!list.ok) return { ok: false, error: 'upstream', status: list.status, body: await list.text().catch(()=> '') };
  const orders = await list.json();

  const norm = String(email).trim().toLowerCase();
  let match = orders.find(o =>
    (String(o.number) === String(orderRef) || String(o.id) === String(orderRef)) &&
    String(o?.billing?.email || '').toLowerCase() === norm
  ) || null;

  if (!match && /^\d+$/.test(String(orderRef))) {
    const one = await fetch(`${cfg.baseUrl}/wp-json/wc/v3/orders/${orderRef}?${qs}`);
    if (one.ok) {
      const j = await one.json();
      if (String(j?.billing?.email || '').toLowerCase() === norm) match = j;
    }
  }

  if (!match) return { ok: false, error: 'not_found', message: 'Brak dopasowania (orderRef/email).' };

  const itemsTotal    = sum(match.line_items || [], it => it.total);
  const shippingTotal = sum(match.shipping_lines || [], s => s.total);
  const discount      = sum(match.coupon_lines || [], c => c.discount);
  const tax           = sum(match.tax_lines || [], t => t.tax_total);

  return {
    ok: true,
    id: match.id,
    number: match.number,
    status: match.status,
    currency: match.currency,
    totals: {
      items_total: asMoney(itemsTotal),
      shipping: asMoney(shippingTotal),
      discount: asMoney(discount),
      tax: asMoney(tax),
    },
    created: match.date_created,
    paid: match.date_paid || null,
    completed: match.date_completed || null,
    customer: {
      email: match?.billing?.email || null,
      name: `${match?.billing?.first_name || ''} ${match?.billing?.last_name || ''}`.trim(),
    },
    addresses: { billing: match.billing || null, shipping: match.shipping || null },
    items: (match.line_items || []).map(it => ({
      id: it.id, name: it.name, sku: it.sku, qty: it.quantity,
      subtotal: it.subtotal, total: it.total, total_tax: it.total_tax
    })),
    shipping_lines: (match.shipping_lines || []).map(s => ({
      method_id: s.method_id, method_title: s.method_title, total: s.total, total_tax: s.total_tax
    })),
  };
}

const HANDLERS = { getOrderDetails };

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body || '{}'); } catch { body = {}; }

  const actionHdr = (req.headers['openai-mcp-action'] || req.headers['x-openai-mcp-action'] || '').toLowerCase();
  const action = body?.action || body?.kind || actionHdr;

  // LIST TOOLS (łapiemy wszystko co wygląda jak list + przypadek pustego body)
  if (!body?.name && (!action || /list/.test(String(action)))) {
    return send(res, 200, { tools: TOOLS });
  }

  // CALL TOOL
  const name = body?.name || body?.tool || body?.toolName;
  const args = body?.arguments || body?.params || {};
  const fn = HANDLERS[name];

  if (!fn) return send(res, 200, { output: JSON.stringify({ ok: false, error: 'unknown_tool', name }) });

  try {
    const result = await fn(args);
    return send(res, 200, { output: JSON.stringify(result) });
  } catch (e) {
    return send(res, 200, { output: JSON.stringify({ ok: false, error: 'tool_failed', message: e?.message || 'err' })});
  }
};
