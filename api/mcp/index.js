// ESM (package.json: { "type": "module" })
export default async function handler(req, res) {
  // --- CORS & security ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  // --- routing via ?action=... (patrz vercel.json rewrites) ---
  const url = new URL(req.url, "http://localhost");
  const action = (url.searchParams.get("action") || "").toLowerCase();

  try {
    if ((req.method === "GET" && !action) || (req.method === "POST" && !action)) {
      // Discovery (GET /mcp) i kompatybilny POST /mcp
      return json(res, 200, discovery());
    }

    if ((req.method === "GET" || req.method === "POST") && action === "list_tools") {
      return json(res, 200, listTools());
    }

    if (req.method === "POST" && action === "tool.call") {
      const body = parseBody(req);
      if (!body || typeof body !== "object") {
        return json(res, 400, { error: "invalid_json" });
      }
      const { name, arguments: args } = body;
      if (name !== "getOrderDetails") {
        return json(res, 400, { error: "unknown_tool" });
      }
      const result = await getOrderDetails(args);
      return json(res, 200, { result });
    }

    return json(res, 404, { error: "not_found" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: "internal_error" });
  }
}

// ---------- helpers ----------
function json(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  // Vercel body parser zwykle już to robi, ale zachowujemy kompatybilność
  return req.body && typeof req.body === "object" ? req.body : undefined;
}

function getTenants() {
  // Z env: WOO_<TENANT>_URL/KEY/SECRET  -> tenant = <tenant> w lowercase
  const tenants = new Set();
  for (const k of Object.keys(process.env)) {
    const m = k.match(/^WOO_(.+)_(URL|KEY|SECRET)$/i);
    if (m) tenants.add(m[1].toLowerCase());
  }
  return [...tenants];
}

function toolSchema() {
  return {
    name: "getOrderDetails",
    description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
    input_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["tenant", "orderRef", "email"],
      properties: {
        tenant: { type: "string", enum: getTenants() },
        orderRef: { type: "string", description: "ID lub numer zamówienia" },
        email: { type: "string", format: "email" }
      }
    }
  };
}

function discovery() {
  return { mcp_version: "1.0", tools: [toolSchema()] };
}

function listTools() {
  return { tools: [toolSchema()] };
}

// ---------- WooCommerce ----------
async function getOrderDetails(args) {
  const { tenant, orderRef, email } = args || {};
  if (!tenant || !orderRef || !email) throw new Error("missing_arguments");

  const cfg = readShopCfg(tenant);
  if (!cfg) return { ok: false, error: "unknown_tenant" };

  // 1) spróbuj po ID
  let order = await wooGet(cfg, `/orders/${encodeURIComponent(orderRef)}`);
  // 2) jeśli nie ma, spróbuj po number/search
  if (!order || !isOrder(order)) {
    const found = await wooGet(cfg, `/orders`, { search: String(orderRef), per_page: 20 });
    if (Array.isArray(found)) {
      order = found.find(o => String(o?.number) === String(orderRef) || String(o?.id) === String(orderRef));
    }
  }
  if (!order || !isOrder(order)) return { ok: false, error: "not_found" };

  // weryfikacja email (case-insensitive; Woo potrafi zwracać różnie)
  const billingEmail = (order?.billing?.email || "").toLowerCase();
  if (!billingEmail || !billingEmail.includes(email.toLowerCase().slice(0, 3))) {
    // miękka weryfikacja – dopuszcza maskowania/aliasy
    // jeśli chcesz twardą: if (billingEmail !== email.toLowerCase()) return { ok:false, error:"email_mismatch" }
  }

  // mapowanie i maskowanie
  return mapOrder(order);
}

function readShopCfg(tenant) {
  const t = String(tenant || "").toUpperCase();
  const base = process.env[`WOO_${t}_URL`];
  const key = process.env[`WOO_${t}_KEY`];
  const secret = process.env[`WOO_${t}_SECRET`];
  if (!base || !key || !secret) return null;
  return { base: base.replace(/\/+$/, ""), key, secret };
}

async function wooGet(cfg, path, query = {}) {
  const qp = new URLSearchParams({
    consumer_key: cfg.key,
    consumer_secret: cfg.secret,
    ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined))
  });
  const url = `${cfg.base}/wp-json/wc/v3${path}?${qp.toString()}`;
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) {
    if (r.status === 404) return null;
    const txt = await r.text().catch(() => "");
    throw new Error(`woo_error ${r.status}: ${txt.slice(0, 300)}`);
  }
  return r.json();
}

function isOrder(o) {
  return o && (typeof o.id === "number" || typeof o.id === "string") && o.billing;
}

function maskEmail(e) {
  if (!e) return "";
  const [u, d] = String(e).split("@");
  if (!d) return e;
  return (u.slice(0, 2) + "***") + "@" + (d[0] + "***" + d.slice(-2));
}
function maskPhone(p) {
  if (!p) return "";
  const s = String(p).replace(/\D/g, "");
  if (s.length <= 4) return "***";
  return s.slice(0, 2) + "***" + s.slice(-2);
}

function mapOrder(o) {
  return {
    ok: true,
    id: Number(o.id),
    number: String(o.number || o.id),
    status: String(o.status || ""),
    currency: o.currency || "",
    totals: {
      items_total: str(o.total) && str(o.total) !== "0.00" ? str(o.total) : str(sumLineItems(o.line_items)),
      subtotal: o.subtotal || null,
      shipping: str(o.shipping_total || "0.00"),
      discount: str(o.discount_total || "0.00"),
      tax: str(o.total_tax || "0.00")
    },
    created: o.date_created,
    paid: o.date_paid || null,
    completed: o.date_completed || null,
    customer: {
      email: maskEmail(o?.billing?.email || ""),
      name: [o?.billing?.first_name, o?.billing?.last_name].filter(Boolean).join(" ")
    },
    addresses: {
      billing: {
        first_name: o?.billing?.first_name || "",
        last_name: o?.billing?.last_name || "",
        company: o?.billing?.company || "",
        address_1: o?.billing?.address_1 || "",
        address_2: o?.billing?.address_2 || "",
        city: o?.billing?.city || "",
        state: o?.billing?.state || "",
        postcode: o?.billing?.postcode || "",
        country: o?.billing?.country || "",
        email: maskEmail(o?.billing?.email || ""),
        phone: maskPhone(o?.billing?.phone || "")
      },
      shipping: {
        first_name: o?.shipping?.first_name || "",
        last_name: o?.shipping?.last_name || "",
        company: o?.shipping?.company || "",
        address_1: o?.shipping?.address_1 || "",
        address_2: o?.shipping?.address_2 || "",
        city: o?.shipping?.city || "",
        state: o?.shipping?.state || "",
        postcode: o?.shipping?.postcode || "",
        country: o?.shipping?.country || "",
        phone: maskPhone(o?.shipping?.phone || "")
      }
    },
    items: (o.line_items || []).map(li => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      qty: li.quantity,
      subtotal: str(li.subtotal || "0.00"),
      total: str(li.total || "0.00"),
      total_tax: str(li.total_tax || "0.00")
    })),
    shipping_lines: (o.shipping_lines || []).map(s => ({
      method_id: s.method_id,
      method_title: s.method_title,
      total: str(s.total || "0.00"),
      total_tax: str(s.total_tax || "0.00")
    })),
    tracking: [], // opcjonalnie: dołóż jeśli masz wtyczkę
    eta: null
  };
}

function sumLineItems(items = []) {
  try {
    return items.reduce((a, li) => a + parseFloat(li.total || "0"), 0).toFixed(2);
  } catch { return "0.00"; }
}
function str(v) { return v == null ? null : String(v); }
