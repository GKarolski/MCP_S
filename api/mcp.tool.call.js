import axios from "axios";

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}

const tenants = {
  demo: {
    base: process.env.TENANT_DEMO_BASE,
    key: process.env.TENANT_DEMO_KEY,
    secret: process.env.TENANT_DEMO_SECRET
  }
};

function woo(tenant){ /* ... bez zmian ... */ }
async function resolveOrderId(api, orderRef){ /* ... bez zmian ... */ }
function extractTracking(meta){ /* ... bez zmian ... */ }
function mask(s){ /* ... bez zmian ... */ }

export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { name, arguments: args } = req.body || {};
    if (name !== "getOrderDetails") return res.status(400).json({ error: "unknown_tool" });
    const { tenant, orderRef, email } = args || {};
    if (!tenant || !orderRef || !email) return res.status(400).json({ error: "bad_args" });

    const api = woo(String(tenant));
    const id = await resolveOrderId(api, orderRef);
    const { data:o } = await api.get(`/orders/${encodeURIComponent(id)}`);

    const ok = String(o?.billing?.email||"").toLowerCase() === String(email||"").toLowerCase();
    if(!ok) return res.json({ result:{ ok:false, reason:"email_mismatch" } });

    const tracking = extractTracking(o?.meta_data||[]);
    const items = (o?.line_items||[]).map(i=>({ id:i.id,name:i.name,sku:i.sku,qty:i.quantity,subtotal:i.subtotal,total:i.total,total_tax:i.total_tax }));
    const shipping_lines = (o?.shipping_lines||[]).map(s=>({ method_id:s.method_id,method_title:s.method_title,total:s.total,total_tax:s.total_tax }));

    res.json({
      result:{
        ok:true,
        id:o.id, number:o.number, status:o.status, currency:o.currency,
        totals:{ items_total:o.total, subtotal:o.subtotal||null, shipping:o.shipping_total, discount:o.discount_total, tax:o.total_tax },
        created:o.date_created, paid:o.date_paid||null, completed:o.date_completed||null,
        customer:{ email:mask(o.billing?.email), name:`${o.billing?.first_name||""} ${o.billing?.last_name||""}`.trim() },
        addresses:{ billing:{...o.billing, email:mask(o.billing?.email), phone:mask(o.billing?.phone) }, shipping:{...o.shipping, phone:mask(o.shipping?.phone)} },
        items, shipping_lines, tracking, eta: null
      }
    });
  } catch(e){
    res.status(200).json({ error: e?.response?.data || e?.message || "error" });
  }
}
