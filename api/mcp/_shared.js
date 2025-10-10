// ESM helpers (Node 18+)

export function getTenantsFromEnv() {
  // Odczyt: WOO_<TENANT>_URL/KEY/SECRET  (np. WOO_SHOP1_URL)
  const map = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^WOO_([A-Z0-9_]+)_(URL|KEY|SECRET)$/);
    if (!m) continue;
    const t = m[1].toLowerCase();
    map[t] ||= { url: null, key: null, secret: null };
    if (m[2] === 'URL') map[t].url = v;
    if (m[2] === 'KEY') map[t].key = v;
    if (m[2] === 'SECRET') map[t].secret = v;
  }
  // tylko kompletne tenancy
  const tenants = {};
  for (const [t, cfg] of Object.entries(map)) {
    if (cfg.url && cfg.key && cfg.secret) tenants[t] = cfg;
  }
  return tenants;
}

export function buildToolDef(tenantNames) {
  return {
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
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, openai-mcp-action, x-openai-*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

export function parseBody(req) {
  try {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    if (req.body && typeof req.body === 'object') return req.body;
  } catch {}
  return {};
}

function wcUrl(tenantCfg, path, qs = {}) {
  const base = tenantCfg.url.replace(/\/+$/, '');
  const url = new URL(base + '/wp-json/wc/v3' + path);
  url.searchParams.set('consumer_key', tenantCfg.key);
  url.searchParams.set('consumer_secret', tenantCfg.secret);
  for (const [k,v] of Object.entries(qs)) url.searchParams.set(k, v);
  return url.toString();
}

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`Woo HTTP ${r.status}`);
  return r.json();
}

const maskEmail = (e) => {
  if (!e || !e.includes('@')) return e || '';
  const [u, d] = e.split('@');
  const mu = u.length <= 2 ? u[0] + '*' : u.slice(0,2) + '***';
  const md = d.length <= 3 ? d[0] + '**' : d.slice(0,1) + '***' + d.slice(-2);
  return `${mu}@${md}`;
};

function normalizeOrder(o) {
  const items = (o.line_items || []).map(li => ({
    id: li.id, name: li.name, sku: li.sku, qty: li.quantity,
    subtotal: li.subtotal, total: li.total, total_tax: li.total_tax
  }));
  const shipping_lines = (o.shipping_lines || []).map(s => ({
    method_id: s.method_id, method_title: s.method_title, total: s.total, total_tax: s.total_tax
  }));
  return {
    ok: true,
    id: o.id,
    number: String(o.number || o.id),
    status: o.status,
    currency: o.currency,
    totals: {
      items_total: (o.line_items || []).reduce((sum, li) => sum + parseFloat(li.total || '0'), 0).toFixed(2),
      subtotal: null,
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
    tracking: [],
    eta: null
  };
}

export async function getOrderDetails(args, tenants) {
  const { tenant, orderRef, email } = args || {};
  const names = Object.keys(tenants);
  if (!names.includes(tenant)) throw new Error('invalid_tenant');
  if (!orderRef) throw new Error('missing_orderRef');

  const cfg = tenants[tenant];
  let order = null;

  if (/^\d+$/.test(String(orderRef))) {
    try { order = await fetchJSON(wcUrl(cfg, `/orders/${orderRef}`)); } catch {}
  }
  if (!order) {
    const list = await fetchJSON(wcUrl(cfg, `/orders`, { search: String(orderRef), per_page: '20' }));
    order = (list || []).find(o => String(o.number || o.id) === String(orderRef)) || list?.[0];
    if (!order) throw new Error('order_not_found');
  }

  const allEmails = [order.billing?.email, order.customer_email].filter(Boolean).map(s => String(s).toLowerCase());
  const ok = allEmails.some(e => String(e).includes(String(email).toLowerCase()));
  if (!ok) throw new Error('email_mismatch');

  return normalizeOrder(order);
}
