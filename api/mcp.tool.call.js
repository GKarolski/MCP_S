import axios from "axios";

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}

const tenants = {
  demo: {
    base: process.env.TENANT_DEMO_BASE,   // np. https://samplestore.pl/wp-json/wc/v3
    key:  process.env.TENANT_DEMO_KEY,
    secret: process.env.TENANT_DEMO_SECRET
  }
};

function woo(tenant){
  const t = tenants[tenant];
  if(!t?.base || !t?.key || !t?.secret) return undefined;
  return axios.create({
    baseURL: `${t.base}`,
    auth: { username: t.key, password: t.secret },
    headers: { 'User-Agent': 'woo-mcp/1.0' },
    timeout: 30000
  });
}

async function resolveOrderId(api, orderRef){
  if(!/^\d+$/.test(String(orderRef))) {
    const { data:list } = await api.get(`/orders`, { params: { search: orderRef, per_page: 1 } });
    if(!Array.isArray(list) || !list[0]?.id) throw new Error('order_not_found');
    return list[0].id;
  }
  return Number(orderRef);
}

function extractTracking(meta=[]){
  const m = meta.find(x => x.key === '_wc_shipment_tracking_items');
  if(!m?.value) return [];
  try {
    const arr = Array.isArray(m.value) ? m.value : JSON.parse(m.value);
    return arr.map(v => ({
      tracking_number: v.tracking_number || v.tracking_id || null,
      provider: v.tracking_provider || null,
      link: v.custom_tracking_link || null,
      date_shipped: v.date_shipped || null
    }));
  } catch { return []; }
}

function mask(s){
  if(!s) return s;
  const str = String(s);
  if(str.includes('@')) {
    const [u,d] = str.split('@');
    return (u.slice(0,2) + '***') + '@' + d.replace(/^(.)(.*)(.)$/,'$1***$3');
  }
  if(str.length <= 4) return '*'.repeat(str.length);
  return str.slice(0,2) + '***' + str.slice(-2);
}

export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({ error:'method_not_allowed' });

  try {
    const { name, arguments: args } = req.body || {};
    if(name !== 'getOrderDetails') return res.status(400).json({ error:'unknown_tool' });

    const tenant = String(args?.tenant||'');
    const orderRef = String(args?.orderRef||'');
    const email = String(args?.email||'').toLowerCase();

    const api = woo(tenant);
    if(!api) return res.status(400).json({ error:'bad_tenant_config' });

    const id = await resolveOrderId(api, orderRef);
    const { data:o } = await api.get(`/orders/${encodeURIComponent(id)}`);

    const mailOk = String(o?.billing?.email||'').toLowerCase() === email;
    if(!mailOk) return res.json({ result:{ ok:false, reason:'email_mismatch' } });

    const items = (o?.line_items||[]).map(i=>({
      id:i.id, name:i.name, sku:i.sku, qty:i.quantity,
      subtotal:i.subtotal, total:i.total, total_tax:i.total_tax
    }));
    const shipping_lines = (o?.shipping_lines||[]).map(s=>({
      method_id:s.method_id, method_title:s.method_title,
      total:s.total,
