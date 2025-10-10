import axios from "axios";

/* --------- CORS ---------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* --------- KONFIG TENANTÓW ---------- */
const tenants = {
  demo: {
    base: process.env.TENANT_DEMO_BASE,   // np. https://samplestore.pl/wp-json/wc/v3
    key:  process.env.TENANT_DEMO_KEY,
    secret: process.env.TENANT_DEMO_SECRET
  }
};

/* --------- KLIENT WOO ---------- */
function woo(tenant) {
  const t = tenants[tenant];
  if (!t?.base || !t?.key || !t?.secret) return undefined;
  return axios.create({
    baseURL: t.base.replace(/\/+$/,""),
    auth: { username: t.key, password: t.secret },
    headers: { "User-Agent": "woo-mcp/1.0" },
    timeout: 30000
  });
}

/* --------- POMOCNICZE ---------- */
async function resolveOrderId(api, orderRef) {
  const ref = String(orderRef || "");
  if (/^\d+$/.test(ref)) return Number(ref);
  const { data: list } = await api.get("/orders", { params: { search: ref, per_page: 1 } });
  if (!Array.isArray(list) || !list[0]?.id) throw new Error("order_not_found");
  return list[0].id;
}

function extractTracking(meta = []) {
  const m = meta.find(x => x.key === "_wc_shipment_tracking_items");
  if (!m?.value) return [];
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

function mask(s) {
  if (!s) return s;
  const str = String(s);
  if (str.includes("@")) {
    const [u, d] = str.split("@");
    const dom = d.replace(/^(.)(.*)(.)$/,"$1***$3");
    return (u.slice(0,2) + "***") + "@" + dom;
  }
  if (str.length <= 4) return "*".repeat(str.length);
  return str.slice(0,2) + "***" + str.slice(-2);
}

/* --------- HANDLER ---------- */
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    // toleruj string body
    let body = req.body ?? {};
    if (typeof body === "string") {
      try { body = JSON.parse(body || "{}"); } catch { body = {}; }
    }

    const { name, arguments: args } = body;
    if (name !== "get_order_details") return res.status(400).json({ error: "unknown_tool" });

    const tenant   = String(args?.tenant || "");
    const orderRef = String(args?.orderRef || "");
    const email    = String(args?.email || "").toLowerCase();

    const api = woo(tenant);
    if (!api) return res.status(400).json({ error: "bad_tenant_config" });

    const id = await resolveOrderId(api, orderRef);
    const { data: o } = await api.get(`/orders/${encodeURIComponent(id)}`);

    const mailOk = String(o?.billing?.email || "").toLowerCase() === email;
    if (!mailOk) return res.json({ result: { ok: false, reason: "email_mismatch" } });

    const items = (o?.line_items || []).map(i => ({
      id: i.id, name: i.name, sku: i.sku, qty: i.quantity,
      subtotal: i.subtotal, total: i.total, total_tax: i.total_tax
    }));

    const shipping_lines = (o?.shipping_lines || []).map(s => ({
      method_id: s.method_id, method_title: s.method_title,
      total: s.total, total_tax: s.total_tax
    }));

    return res.json({
      result: {
        ok: true,
        id: o.id, number: o.number, status: o.status, currency: o.currency,
        totals: {
          items_total: o.total,
          subtotal: o.subtotal || null,
          shipping: o.shipping_total,
          discount: o.discount_total,
          tax: o.total_tax
        },
        created: o.date_created,
        paid: o.date_paid || null,
        completed: o.date_completed || null,
        customer: {
          email: mask(o.billing?.email),
          name: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim()
        },
        addresses: {
          billing: { ...o.billing, email: mask(o.billing?.email), phone: mask(o.billing?.phone) },
          shipping:{ ...o.shipping, phone: mask(o.shipping?.phone) }
        },
        items, shipping_lines,
        tracking: extractTracking(o?.meta_data || []),
        eta: null
      }
    });

  } catch (e) {
    const payload = e?.response?.data || { message: String(e?.message || e) };
    return res.status(200).json({ error: payload });
  }
}
