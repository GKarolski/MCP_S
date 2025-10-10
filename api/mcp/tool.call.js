import axios from "axios";

const tenants = {
  demo: {
    base: process.env.TENANT_DEMO_BASE,
    key: process.env.TENANT_DEMO_KEY,
    secret: process.env.TENANT_DEMO_SECRET
  }
};

function woo(tenant) {
  const t = tenants[tenant];
  if (!t?.base || !t?.key || !t?.secret) throw new Error("tenant_missing_or_unconfigured");
  return axios.create({
    baseURL: `${t.base.replace(/\/$/,"")}/wp-json/wc/v3`,
    auth: { username: t.key, password: t.secret },
    timeout: 10000,
    headers: { "User-Agent": "mcp-woo/0.2" }
  });
}

async function resolveOrderId(api, orderRef) {
  // jeśli czysta liczba, traktuj jako ID
  if (/^\d+$/.test(String(orderRef))) return String(orderRef);
  // inaczej szukaj po numerze
  const { data: list } = await api.get('/orders', { params: { search: String(orderRef), per_page: 20 } });
  const hit = Array.isArray(list) ? list.find(o => String(o.number) === String(orderRef)) : null;
  if (!hit) throw new Error('order_not_found_by_number');
  return String(hit.id);
}

function extractTracking(meta) {
  if (!Array.isArray(meta)) return null;
  const byKey = k => meta.find(m => m?.key === k)?.value;
  const direct = byKey("tracking_number") || byKey("_tracking_number");
  if (direct) return [{ tracking_number: String(direct) }];
  const shipItems = byKey("_wc_shipment_tracking_items");
  if (Array.isArray(shipItems) && shipItems.length) {
    return shipItems.map(it => ({
      tracking_number: it?.tracking_number ?? null,
      provider: it?.tracking_provider || it?.custom_tracking_provider || null,
      link: it?.custom_tracking_link || null,
      date_shipped: it?.date_shipped || null
    }));
  }
  return null;
}

function mask(s) {
  if (!s) return s;
  const t = String(s);
  if (t.length <= 4) return "***";
  return t.slice(0, 2) + "***" + t.slice(-2);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    const { name, arguments: args } = req.body || {};
    if (name !== "getOrderDetails") return res.status(400).json({ error: "unknown_tool" });

    const { tenant, orderRef, email } = args || {};
    if (!tenant || !orderRef || !email) return res.status(400).json({ error: "bad_args" });

    const api = woo(String(tenant));
    const id = await resolveOrderId(api, orderRef);

    const { data: o } = await api.get(`/orders/${encodeURIComponent(id)}`);

    const ok = String(o?.billing?.email || "").toLowerCase() === String(email || "").toLowerCase();
    if (!ok) return res.json({ result: { ok: false, reason: "email_mismatch" } });

    const tracking = extractTracking(o?.meta_data || []);
    const items = (o?.line_items || []).map(i => ({
      id: i.id, name: i.name, sku: i.sku, qty: i.quantity,
      subtotal: i.subtotal, total: i.total, total_tax: i.total_tax
    }));
    const shipping_lines = (o?.shipping_lines || []).map(s => ({
      method_id: s.method_id, method_title: s.method_title,
      total: s.total, total_tax: s.total_tax
    }));

    res.json({
      result: {
        ok: true,
        id: o.id,
        number: o.number,
        status: o.status,
        currency: o.currency,
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
          shipping: { ...o.shipping, phone: mask(o.shipping?.phone) }
        },
        items,
        shipping_lines,
        tracking,
        eta: (o?.meta_data || []).find(m => m?.key === "estimated_delivery")?.value || null
      }
    });
  } catch (e) {
    res.status(200).json({ error: e?.response?.data || e?.message || "error" });
  }
}
