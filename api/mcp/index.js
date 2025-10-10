const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function withCors(res) { for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v); }
function send(res, code, obj) { withCors(res); res.status(code).setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(obj)); }
function ok(res, obj){ send(res,200,obj); }
function bad(res,msg){ send(res,400,{error:msg}); }
function notf(res,msg){ send(res,404,{error:msg||"not_found"}); }
function oops(res,msg){ send(res,500,{error:msg||"server_error"}); }
function parseJSON(raw){ try{return JSON.parse(raw||"{}");}catch{return null;} }

function maskEmail(e){ if(!e) return ""; const [u,d]=e.split("@"); return (u?.slice(0,2)||"")+"***@"+(d?d.replace(/^[^.]*/,m=>m[0]+"***"):"***"); }
function maskPhone(p){ return p? String(p).slice(0,2)+"***"+String(p).slice(-2) : ""; }

function getTenantsFromEnv(){
  const found = {};
  for (const [k] of Object.entries(process.env)) {
    const m = k.match(/^WOO_([A-Z0-9_]+)_URL$/i);
    if (m) {
      const NAME = m[1];
      const url = process.env[`WOO_${NAME}_URL`];
      const key = process.env[`WOO_${NAME}_KEY`];
      const secret = process.env[`WOO_${NAME}_SECRET`];
      if (url && key && secret) found[NAME.toLowerCase()] = { url: url.replace(/\/$/,''), key, secret };
    }
  }
  return found;
}

function listToolsPayload(){
  const tenants = Object.keys(getTenantsFromEnv());
  return {
    tools: [{
      name: "getOrderDetails",
      description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
      input_schema: {
        "$schema":"https://json-schema.org/draft/2020-12/schema",
        "type":"object",
        "additionalProperties":false,
        "required":["tenant","orderRef","email"],
        "properties":{
          "tenant":{"type":"string","enum": tenants.length?tenants:["demo"]},
          "orderRef":{"type":"string","description":"ID lub numer zamówienia"},
          "email":{"type":"string","format":"email"}
        }
      }
    }]
  };
}

async function wooGetJson(url){
  const r = await fetch(url, { headers: { "Accept":"application/json" } });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    const err = new Error(`Woo request failed: ${r.status} ${r.statusText} ${t}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function sanitizeOrder(o){
  const billing  = o.billing || {};
  const shipping = o.shipping || {};
  return {
    ok: true,
    id: o.id,
    number: o.number || String(o.id),
    status: o.status,
    currency: o.currency,
    totals: {
      items_total: o.total ? (Number(o.total) - Number(o.shipping_total||0)).toFixed(2) : null,
      subtotal: o.subtotal || null,
      shipping: o.shipping_total ?? null,
      discount: o.discount_total ?? "0.00",
      tax: o.total_tax ?? "0.00"
    },
    created: o.date_created_gmt || o.date_created || null,
    paid: o.date_paid_gmt || o.date_paid || null,
    completed: o.date_completed_gmt || o.date_completed || null,
    customer: {
      email: maskEmail(billing.email || o.customer_email),
      name: [billing.first_name, billing.last_name].filter(Boolean).join(" ").trim()
    },
    addresses: {
      billing: {
        first_name: billing.first_name || "", last_name: billing.last_name || "",
        company: billing.company || "", address_1: billing.address_1 || "", address_2: billing.address_2 || "",
        city: billing.city || "", state: billing.state || "", postcode: billing.postcode || "", country: billing.country || "",
        email: maskEmail(billing.email || ""), phone: maskPhone(billing.phone || "")
      },
      shipping: {
        first_name: shipping.first_name || "", last_name: shipping.last_name || "",
        company: shipping.company || "", address_1: shipping.address_1 || "", address_2: shipping.address_2 || "",
        city: shipping.city || "", state: shipping.state || "", postcode: shipping.postcode || "", country: shipping.country || "",
        phone: maskPhone(shipping.phone || "")
      }
    },
    items: (o.line_items||[]).map(it=>({ id:it.id, name:it.name, sku:it.sku, qty:it.quantity, subtotal:it.subtotal, total:it.total, total_tax:it.total_tax })),
    shipping_lines: (o.shipping_lines||[]).map(s=>({ method_id:s.method_id, method_title:s.method_title, total:s.total, total_tax:s.total_tax })),
    tracking: [],
    eta: null
  };
}

async function getOrderByRef(cfg, ref){
  const base = `${cfg.url}/wp-json/wc/v3`;
  const auth = `consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`;

  if (/^\d+$/.test(String(ref))) {
    try {
      const byId = await wooGetJson(`${base}/orders/${encodeURIComponent(ref)}?${auth}`);
      if (byId?.id) return byId;
    } catch(e){ if (!e.status || e.status !== 404) throw e; }
  }

  const list = await wooGetJson(`${base}/orders?search=${encodeURIComponent(ref)}&per_page=20&${auth}`);
  const hit = Array.isArray(list) ? list.find(o => String(o.number||o.id) === String(ref)) : null;
  if (hit) return hit;

  const recent = await wooGetJson(`${base}/orders?orderby=date&order=desc&per_page=30&${auth}`);
  const hit2 = Array.isArray(recent) ? recent.find(o => String(o.number||o.id) === String(ref)) : null;
  return hit2 || null;
}

async function handleGetOrderDetails(args){
  const tenants = getTenantsFromEnv();
  const tenant = (args.tenant||"").toLowerCase();
  if (!tenants[tenant]) return { error:"unknown_tenant", tenants:Object.keys(tenants) };

  const orderRef = String(args.orderRef||"").trim();
  const email = String(args.email||"").trim().toLowerCase();
  if (!orderRef || !email || !email.includes("@")) return { error:"invalid_arguments" };

  const order = await getOrderByRef(tenants[tenant], orderRef);
  if (!order) return { error:"order_not_found" };

  const billingEmail = (order.billing?.email || order.customer_email || "").toLowerCase();
  if (billingEmail && billingEmail !== email) return { error:"email_mismatch" };

  return { result: sanitizeOrder(order) };
}

module.exports = {
  CORS, withCors, ok, bad, notf, oops, parseJSON,
  listToolsPayload, handleGetOrderDetails
};
