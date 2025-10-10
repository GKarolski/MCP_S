// ESM handler for Vercel (Node 18+)
export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, openai-mcp-action, x-openai-*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // --- Tenants from ENV ---
  const tenants = {};
  if (process.env.WOO_SHOP1_URL && process.env.WOO_SHOP1_KEY && process.env.WOO_SHOP1_SECRET) {
    tenants.shop1 = {
      url: process.env.WOO_SHOP1_URL,
      key: process.env.WOO_SHOP1_KEY,
      secret: process.env.WOO_SHOP1_SECRET
    };
  }
  const tenantNames = Object.keys(tenants);

  // --- Tool schema (shared) ---
  const toolDef = {
    name: 'getOrderDetails',
    description: 'Zwraca dane zamówienia WooCommerce po ID/num., weryfikuje email.',
    input_schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['tenant','orderRef','email'],
      properties: {
        tenant: { type: 'string', enum: tenantNames.length ? tenantNames : ['shop1'] },
        orderRef: { type: 'string', description: 'ID lub numer zamówienia' },
        email: { type: 'string', format: 'email' }
      }
    }
  };

  // --- Helpers ---
  const jsonOk = (obj) => res.status(200).json(obj);
  const jsonErr = (code, msg, detail) => res.status(code).json({ error: msg, detail });

  const readBody = () => {
    try {
      if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
      if (req.body && typeof req.body === 'object') return req.body;
    } catch {}
    return {};
  };

  // Build Woo URL with key/secret qs
  const wcUrl = (t, path, qs={}) => {
    const base = tenants[t].url.replace(/\/+$/, '');
    const url = new URL(base + '/wp-json/wc/v3' + path);
    url.searchParams.set('consumer_key', tenants[t].key);
    url.searchParams.set('consumer_secret', tenants[t].secret);
    Object.entries(qs).forEach(([k,v]) => url.searchParams.set(k, v));
    return url.toString();
  };

  const fetchJSON = async (url) => {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`Woo HTTP ${r.status}`);
    return r.json();
  };

  const maskEmail = (e) => {
    if (!e || !e.includes('@')) return e || '';
    const [u, d] = e.split('@');
    const mu = u.length <= 2 ? u[0] + '*' : u.slice(0,2) + '***';
    const md = d.length <= 3 ? d[0] + '**' : d.slice(0,1) + '***' + d.slice(-2);
    return `${mu}@${md}`.replace(/\.\*\*\*([a-z])?$/i, '.***$1');
  };

  function normalizeOrder(o) {
    const items = (o.line_items || []).map(li => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      qty: li.quantity,
      subtotal: li.subtotal,
      total: li.total,
      total_tax: li.total_tax
    }));

    const shipping_lines = (o.shipping_lines || []).map(s => ({
      method_id: s.method_id,
      method_title: s.method_title,
      total: s.total,
      total_tax: s.total_tax
    }));

    return {
      ok: true,
      id: o.id,
      number: String(o.number || o.id),
      status: o.status,
      currency: o.currency,
      totals: {
        items_total: (o.line_items || []).reduce((sum, li) => sum + parseFloat(li.total || '0'), 0).toFixed(2),
        subtotal: o.total ? null : null,
        shipping: (o.shipping_lines?.[0]?.total) || '0.00',
        discount: (o.discount_total ?? '0.00'),
        tax: (o.total_tax ?? '0.00')
      },
      created: o.date_created,
      paid: o.date_paid,
      completed: o.date_completed,
      customer: {
        email: maskEmail(o.billing?.email || o.customer_email || ''),
        name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || ''
      },
      addresses: {
        billing: {
          first_name: o.billing?.first_name || '',
          last_name: o.billing?.last_name || '',
          company: o.billing?.company || '',
          address_1: o.billing?.address_1 || '',
          address_2: o.billing?.address_2 || '',
          city: o.billing?.city || '',
          state: o.billing?.state || '',
          postcode: o.billing?.postcode || '',
          country: o.billing?.country || '',
          email: maskEmail(o.billing?.email || ''),
          phone: (o.billing?.phone || '').replace(/(\d{2})\d+(\d{2})$/, '$1***$2')
        },
        shipping: {
          first_name: o.shipping?.first_name || '',
          last_name: o.shipping?.last_name || '',
          company: o.shipping?.company || '',
          address_1: o.shipping?.address_1 || '',
          address_2: o.shipping?.address_2 || '',
          city: o.shipping?.city || '',
          state: o.shipping?.state || '',
          postcode: o.shipping?.postcode || '',
          country: o.shipping?.country || '',
          phone: (o.billing?.phone || '').replace(/(\d{2})\d+(\d{2})$/, '$1***$2')
        }
      },
      items,
      shipping_lines,
      tracking: [], // jeśli masz pluginy tracking – można tu dodać
      eta: null
    };
  }

  async function getOrderDetails(args) {
    const { tenant, orderRef, email } = args || {};
    if (!tenantNames.includes(tenant)) throw new Error('invalid_tenant');
    if (!orderRef) throw new Error('missing_orderRef');

    let order = null;

    // 1) spróbuj jako ID
    if (/^\d+$/.test(String(orderRef))) {
      try {
        order = await fetchJSON(wcUrl(tenant, `/orders/${orderRef}`));
      } catch {}
    }

    // 2) szukaj po numerze (fallback)
    if (!order) {
      const list = await fetchJSON(wcUrl(tenant, `/orders`, { search: String(orderRef), per_page: '20' }));
      order = (list || []).find(o => String(o.number || o.id) === String(orderRef)) || list?.[0];
      if (!order) throw new Error('order_not_found');
    }

    // 3) weryfikacja email
    const allEmails = [
      order.billing?.email,
      order.customer_email
    ].filter(Boolean).map(s => String(s).toLowerCase());

    const ok = allEmails.some(e => String(e).includes(String(email).toLowerCase()));
    if (!ok) throw new Error('email_mismatch');

    return normalizeOrder(order);
  }

  // --- ROUTING ---

  // GET /mcp  -> discovery (dla Buildera)
  if (req.method === 'GET') {
    return jsonOk({
      mcp_version: '1.0',
      tools: [toolDef]
    });
  }

  if (req.method !== 'POST') return jsonErr(405, 'method_not_allowed');

  // POST /mcp (list_tools lub call_tool)
  const body = readBody();
  const actionHdr = (req.headers['openai-mcp-action'] || req.headers['x-openai-mcp-action'] || '').toString();

  const isCall = !!body?.name || actionHdr === 'call_tool';
  if (!isCall) {
    // list_tools
    return jsonOk({ tools: [toolDef] });
  }

  // call_tool
  try {
    if (body?.name !== 'getOrderDetails') throw new Error('unknown_tool');
    const result = await getOrderDetails(body.arguments || {});
    // Builder lubi { output: "<json string>" }
    return jsonOk({ output: JSON.stringify({ result }) });
  } catch (e) {
    console.error('tool_failed', e);
    return jsonErr(500, 'tool_failed', e?.message || String(e));
  }
}
