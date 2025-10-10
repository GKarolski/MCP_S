// ESM: w package.json musi być { "type": "module" }
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,authorization,openai-mcp-action,x-openai-mcp-action,x-openai-organization,x-openai-project"
  );
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // Body (Vercel zwykle już parsuje, ale na wszelki wypadek)
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { body = {}; }
  }
  const actionHdr = String(
    req.headers["openai-mcp-action"] || req.headers["x-openai-mcp-action"] || ""
  ).toLowerCase();

  // Jeśli brak body.name i brak nagłówka "call_tool" → lista narzędzi
  const isCall = !!(body && body.name) || actionHdr === "call_tool";
  if (!isCall) {
    return res.status(200).json({
      tools: [toolSchema()]
    });
  }

  // Wywołanie narzędzia
  const { name, arguments: args } = body || {};
  if (name !== "getOrderDetails") {
    return res.status(400).json({ error: "unknown_tool" });
  }

  try {
    const result = await getOrderDetails(args);
    // Zwracamy w polu "output" jako string (zgodnie z oczekiwaniem Buildera)
    return res.status(200).json({ output: JSON.stringify({ result }) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "tool_failed", detail: String(e?.message || e) });
  }
}

/* ---------- definicje i utils ---------- */

function toolSchema() {
  return {
    name: "getOrderDetails",
    description: "Zwraca dane zamówienia WooCommerce po ID/num., weryfikuje email.",
    input_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["tenant", "orderRef", "email"],
      properties: {
        tenant: { type: "string", enum: detectTenants() },
        orderRef: { type: "string", description: "ID lub numer zamówienia" },
        email: { type: "string", format: "email" }
      }
    }
  };
}

function detectTenants() {
  // Szuka zmiennych: WOO_<TENANT>_URL/KEY/SECRET → tenant to <tenant> (lowercase)
  const tenants = new Set();
  for (const k of Object.keys(process.env)) {
    const m = k.match(/^WOO_(.+)_(URL|KEY|SECRET)$/i);
    if (m) tenants.add(m[1].toLowerCase());
  }
  const list = [...tenants];
  return list.length ? list : ["shop1"]; // fallback, żeby Builder zawsze coś widział
}

async function getOrderDetails(args) {
  const { tenant, orderRef, email } = args || {};
  if (!tenant || !orderRef || !email) throw new Error("missing_arguments");

  const cfg = readShopCfg(tenant);
  if (!cfg) throw new Error("unknown_tenant");

  // 1) po ID
  let order = await wooGet(cfg, `/orders/${encodeURIComponent(orderRef)}`);
  // 2) jeśli brak → search po numerze
  if (!isOrder(order)) {
    const found = await wooGet(cfg, "/orders", { search: String(orderRef), per_page: 20 });
    if (Array.isArray(found)) {
      order = found.find(
        (o) => String(o?.number) === String(orderRef) || String(o?.id) === String(orderRef)
      );
    }
  }
  if (!isOrder(order)) throw new Error("not_found");

  // twarda weryfikacja email (case-insensitive)
  const billingEmail = String(order?.billing?.email || "").toLowerCase();
  if (billingEmail !== String(email).toLowerCase()) {
    throw new Error("email_mismatch");
  }

  return mapOrder(order);
}

function readShopCfg(tenant) {
  const T = String(tenant || "").toUpperCase();
  const base = process.env[`WOO_${T}_URL`];
  const key = process.env[`WOO_${T}_KEY`];
  const secret = process.env[`WOO_${T}_SECRET`];
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
      items_total: String(o.total ?? "0.00"),
      subtotal: o.subtotal || null,
      shipping: String(o.shipping_total ?? "0.00"),
      discount: String(o.discount_total ?? "0.00"),
      tax: String(o.total_tax ?? "0.00")
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
      subtotal: String(li.subtotal ?? "0.00"),
      total: String(li.total ?? "0.00"),
      total_tax: String(li.total_tax ?? "0.00")
    })),
    shipping_lines: (o.shipping_lines || []).map(s => ({
      method_id: s.method_id,
      method_title: s.method_title,
      total: String(s.total ?? "0.00"),
      total_tax: String(s.total_tax ?? "0.00")
    })),
    tracking: [],
    eta: null
  };
}
