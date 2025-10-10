// ESM handler dla wszystkich endpointów MCP (discovery, list_tools, tool.call)
// Używa zmiennych środowiskowych:
//   WOO_<TENANT>_URL, WOO_<TENANT>_KEY, WOO_<TENANT>_SECRET
// np. WOO_SHOP1_URL=https://twoj-sklep.pl

// --- CORS ---
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const setCors = (res) => { for (const [k,v] of Object.entries(CORS)) res.setHeader(k,v); };
const send = (res, code, data) => {
  setCors(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
};
const ok = (res, data) => send(res, 200, data);
const bad = (res, msg) => send(res, 400, { error: msg });
const notf = (res, msg="not_found") => send(res, 404, { error: msg });
const oops = (res, err) => send(res, 500, { error: err?.message || "server_error" });

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}
const parseJSON = (raw) => { try { return JSON.parse(raw || "{}"); } catch { return null; } };

// --- Tenants z ENV ---
function getTenants() {
  const out = {};
  for (const k of Object.keys(process.env)) {
    const m = k.match(/^WOO_([A-Z0-9_]+)_URL$/i);
    if (m) {
      const NAME = m[1];
      const url = process.env[`WOO_${NAME}_URL`];
      const key = process.env[`WOO_${NAME}_KEY`];
      const secret = process.env[`WOO_${NAME}_SECRET`];
      if (url && key && secret) {
        out[NAME.toLowerCase()] = { url: url.replace(/\/$/, ""), key, secret };
      }
    }
  }
  return out;
}

function toolsPayload() {
  const tenants = Object.keys(getTenants());
  // enum nie może być pusty — jeśli brak ENV, pokaż "shop1" jako placeholder
  const enumVals = tenants.length ? tenants : ["shop1"];
  return {
    tools: [{
      name: "getOrderDetails",
      description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
      input_schema: {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "required": ["tenant","orderRef","email"],
        "properties": {
          "tenant": { "type":"string", "enum": enumVals },
          "orderRef": { "type":"string", "description":"ID lub numer zamówienia" },
          "email": { "type":"string", "format":"email" }
        }
      }
    }]
  };
}

// --- Woo helpers ---
async function getJson(url) {
  const r = await fetch(url, { headers: { "Accept":"application/json" } });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    const e = new Error(`Woo request failed: ${r.status} ${r.statusText} ${t}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function findOrder(cfg, ref) {
  const base = `${cfg.url}/wp-json/wc/v3`;
  const auth = `consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`;

  // ID
  if (/^\d+$/.test(String(ref))) {
    try {
      const byId = await getJson(`${base}/orders/${encodeURIComponent(ref)}?${auth}`);
      if (byId?.id) return byId;
    } catch (e) { if (e.status !== 404) throw e; }
  }
  // search
  const list = await getJson(`${base}/orders?search=${encodeURIComponent(ref)}&per_page=20&${auth}`);
  let hit = Array.isArray(list) ? list.find(o => String(o.number||o.id) === String(ref)) : null;
  if (hit) return hit;

  // fallback: ostatnie
  const recent = await getJson(`${base}/orders?orderby=date&order=desc&per_page=30&${auth}`);
  hit = Array.isArray(recent) ? recent.find(o => String(o.number||o.id) === String(ref)) : null;
  return hit || null;
}

const maskEmail = (e) => {
  if(!e) return "";
  const [u,d]=e.split("@");
  const u2 = (u||"").slice(0,2)+"***";
  const d2 = d ? d.replace(/^[^.@]+/, m => (m[0]||"")+"***") : "***";
  return `${u2}@${d2}`;
};
const maskPhone = (p) => p ? String(p).slice(0,2)+"***"+String(p).slice(-2) : "";

function shapeOrder(o) {
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
      tax: o.total_tax ?? "0.00",
    },
    created: o.date_created_gmt || o.date_created || null,
    paid: o.date_paid_gmt || o.date_paid || null,
    completed: o.date_completed_gmt || o.date_completed || null,
    customer: {
      email: maskEmail(billing.email || o.customer_email || ""),
      name: [billing.first_name, billing.last_name].filter(Boolean).join(" ").trim(),
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
    items: (o.line_items||[]).map(it => ({
      id: it.id, name: it.name, sku: it.sku, qty: it.quantity,
      subtotal: it.subtotal, total: it.total, total_tax: it.total_tax
    })),
    shipping_lines: (o.shipping_lines||[]).map(s => ({
      method_id: s.method_id, method_title: s.method_title, total: s.total, total_tax: s.total_tax
    })),
    tracking: [],
    eta: null
  };
}

async function run_getOrderDetails(args) {
  const tenants = getTenants();
  const tenant = String(args.tenant||"").toLowerCase();
  if (!tenants[tenant]) return { error:"unknown_tenant", tenants: Object.keys(tenants) };

  const orderRef = String(args.orderRef||"").trim();
  const email = String(args.email||"").trim().toLowerCase();
  if (!orderRef || !email || !email.includes("@")) return { error:"invalid_arguments" };

  const order = await findOrder(tenants[tenant], orderRef);
  if (!order) return { error:"order_not_found" };

  const billingEmail = (order.billing?.email || order.customer_email || "").toLowerCase();
  if (billingEmail && billingEmail !== email) return { error:"email_mismatch" };

  return { result: shapeOrder(order) };
}

// --- Główny handler (jedyny plik) ---
export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.statusCode = 204; setCors(res); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  const isDiscovery = p === "/mcp" || p === "/api/mcp";
  const isList     = p === "/mcp/list_tools" || p === "/api/mcp/list_tools";
  const isCall     = p === "/mcp/tool.call"  || p === "/api/mcp/tool.call";

  try {
    // discovery GET/POST
    if (isDiscovery && (req.method === "GET" || req.method === "POST")) {
      return ok(res, { mcp_version: "1.0", ...toolsPayload() });
    }
    // list_tools POST
    if (isList && req.method === "POST") {
      return ok(res, toolsPayload());
    }
    // tool.call POST
    if (isCall && req.method === "POST") {
      const raw = await readBody(req);
      const body = parseJSON(raw);
      if (!body) return bad(res, "invalid_json");
      if (body.name !== "getOrderDetails") return notf(res, "unknown_tool");
      const out = await run_getOrderDetails(body.arguments || {});
      return ok(res, out);
    }

    // Fallback
    res.statusCode = 405;
    setCors(res);
    return res.end();
  } catch (e) {
    return oops(res, e);
  }
}
