export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, OpenAI-Organization, OpenAI-Project, Origin, x-openai-*"
  );
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const send = (id, result) => res.status(200).json({ jsonrpc: "2.0", id, result });
  const sendErr = (id, code, message) =>
    res.status(200).json({ jsonrpc: "2.0", id, error: { code, message } });

  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const { id, method, params } = body || {};

  try {
    const tenants = readTenants();
    const tenantNames = Object.keys(tenants);

    const tools = [
      {
        name: "getOrderDetails",
        description: "Zwraca dane zamówienia WooCommerce po ID/num., weryfikuje email.",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          required: ["tenant", "orderRef", "email"],
          properties: {
            tenant: { type: "string", enum: tenantNames.length ? tenantNames : ["shop1"] },
            orderRef: { type: "string", description: "ID lub numer zamówienia" },
            email: { type: "string", format: "email" }
          }
        }
      }
    ];

    if (method === "initialize") {
      return send(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "woo-mcp", version: "1.0.1" }
      });
    }

    if (method === "tools/list") {
      return send(id, { tools });
    }

    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};

      if (name !== "getOrderDetails") return sendErr(id, -32601, "Unknown tool");

      const { tenant, orderRef, email } = args || {};
      if (!tenant || !orderRef || !email) return sendErr(id, -32602, "tenant, orderRef i email są wymagane");

      try {
        const result = await getOrderDetailsWoo(tenants, {
          tenant: String(tenant),
          orderRef: String(orderRef),
          email: String(email)
        });

        // 🔑 Builder bywa wrażliwy – zwracamy TEXT, nie {type:"json"}
        return send(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false
        });
      } catch (e) {
        const msg = e?.message || String(e);
        const code =
          msg === "invalid_tenant" ? -32001 :
          msg === "order_not_found" ? -32004 :
          msg === "email_mismatch" ? -32005 :
          -32000;
        return sendErr(id, code, msg);
      }
    }

    return sendErr(id, -32601, "Method not found");
  } catch (e) {
    console.error("MCP error", e);
    return res.status(200).json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message: e.message } });
  }
}

/* -------- helpers -------- */
function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

function readTenants() {
  const map = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^WOO_([A-Z0-9_]+)_(URL|KEY|SECRET)$/);
    if (!m) continue;
    const t = m[1].toLowerCase();
    map[t] ||= { url: null, key: null, secret: null };
    if (m[2] === "URL") map[t].url = v;
    if (m[2] === "KEY") map[t].key = v;
    if (m[2] === "SECRET") map[t].secret = v;
  }
  const ok = {};
  for (const [t, cfg] of Object.entries(map)) {
    if (cfg.url && cfg.key && cfg.secret) ok[t] = cfg;
  }
  return ok;
}

async function getOrderDetailsWoo(tenants, { tenant, orderRef, email }) {
  if (!tenants[tenant]) throw new Error("invalid_tenant");
  const cfg = tenants[tenant];

  let order = null;
  if (/^\d+$/.test(orderRef)) {
    order = await tryFetch(wcUrl(cfg, `/orders/${orderRef}`));
  }
  if (!order) {
    const list = await mustFetch(wcUrl(cfg, `/orders`, { search: orderRef, per_page: "20" }));
    order = (list || []).find(o => String(o.number || o.id) === String(orderRef)) || list?.[0];
    if (!order) throw new Error("order_not_found");
  }

  const emails = [order.billing?.email, order.customer_email].filter(Boolean).map(s => String(s).toLowerCase());
  const ok = emails.some(e => e.includes(String(email).toLowerCase()));
  if (!ok) throw new Error("email_mismatch");

  return normalizeOrder(order);
}

function wcUrl(cfg, path, qs = {}) {
  const base = cfg.url.replace(/\/+$/, "");
  const url = new URL(base + "/wp-json/wc/v3" + path);
  url.searchParams.set("consumer_key", cfg.key);
  url.searchParams.set("consumer_secret", cfg.secret);
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return url.toString();
}

async function mustFetch(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    // ⏱️ twardy timeout, żeby nie wywaliło 424 w Builderze
    signal: AbortSignal.timeout(25000)
  });
  if (!r.ok) throw new Error(`Woo HTTP ${r.status}`);
  return r.json();
}
async function tryFetch(url) { try { return await mustFetch(url); } catch { return null; } }

const maskEmail = (e) => {
  if (!e || !e.includes("@")) return e || "";
  const [u, d] = e.split("@");
  const mu = u.length <= 2 ? u[0] + "*" : u.slice(0, 2) + "***";
  const md = d.length <= 3 ? d[0] + "**" : d.slice(0, 1) + "***" + d.slice(-2);
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
      items_total: (o.line_items || []).reduce((sum, li) => sum + parseFloat(li.total || "0"), 0).toFixed(2),
      subtotal: null,
      shipping: (o.shipping_lines?.[0]?.total) || "0.00",
      discount: (o.discount_total ?? "0.00"),
      tax: (o.total_tax ?? "0.00")
    },
    created: o.date_created,
    paid: o.date_paid,
    completed: o.date_completed,
    customer: {
      email: maskEmail(o.billing?.email || o.customer_email || ""),
      name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" ") || ""
    },
    addresses: {
      billing: {
        first_name: o.billing?.first_name || "",
        last_name: o.billing?.last_name || "",
        company: o.billing?.company || "",
        address_1: o.billing?.address_1 || "",
        address_2: o.billing?.address_2 || "",
        city: o.billing?.city || "",
        state: o.billing?.state || "",
        postcode: o.billing?.postcode || "",
        country: o.billing?.country || "",
        email: maskEmail(o.billing?.email || ""),
        phone: (o.billing?.phone || "").replace(/(\d{2})\d+(\d{2})$/, "$1***$2")
      },
      shipping: {
        first_name: o.shipping?.first_name || "",
        last_name: o.shipping?.last_name || "",
        company: o.shipping?.company || "",
        address_1: o.shipping?.address_1 || "",
        address_2: o.shipping?.address_2 || "",
        city: o.shipping?.city || "",
        state: o.shipping?.state || "",
        postcode: o.shipping?.postcode || "",
        country: o.shipping?.country || "",
        phone: (o.billing?.phone || "").replace(/(\d{2})\d+(\d{2})$/, "$1***$2")
      }
    },
    items,
    shipping_lines,
    tracking: [],
    eta: null
  };
}
