/* MCP server for Vercel (CommonJS)
   Endpoints:
   - GET  /mcp               -> discovery (mcp_version + tools)
   - POST /mcp/list_tools    -> list tools
   - GET  /mcp/list_tools    -> list tools (also allowed)
   - POST /mcp/tool.call     -> call tool
*/

const encodeBasic = (k, s) =>
  Buffer.from(`${k}:${s}`, "utf8").toString("base64");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function send(res, status, payload) {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function ok(res, payload) { send(res, 200, payload); }
function bad(res, msg) { send(res, 400, { error: msg }); }
function notFound(res) { send(res, 404, { error: "not_found" }); }
function serverError(res, e) {
  send(res, 500, { error: "internal_error", detail: (e && e.message) || String(e) });
}

// ---------- Tenants from ENV ----------
// Expect ENV like:
// WOO_SHOP1_URL, WOO_SHOP1_KEY, WOO_SHOP1_SECRET
function getWooTenants() {
  const groups = {}; // id -> {URL, KEY, SECRET}
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^WOO_([A-Z0-9_]+)_(URL|KEY|SECRET)$/i.exec(k);
    if (!m) continue;
    const id = m[1].toLowerCase(); // shop1 -> lower
    const field = m[2].toUpperCase();
    groups[id] = groups[id] || {};
    groups[id][field] = v;
  }
  // keep only fully-configured tenants
  const out = {};
  Object.entries(groups).forEach(([id, cfg]) => {
    if (cfg.URL && cfg.KEY && cfg.SECRET) out[id] = cfg;
  });
  return out;
}

// ---------- Woo API helpers ----------
async function wooFetch(tenantCfg, path) {
  const base = tenantCfg.URL.replace(/\/+$/, "");
  const url = `${base}/wp-json/wc/v3${path}`;
  const resp = await fetch(url, {
    headers: {
      "Authorization": `Basic ${encodeBasic(tenantCfg.KEY, tenantCfg.SECRET)}`
    }
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Woo request failed ${resp.status}: ${text}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

async function findOrder(tenantCfg, orderRef) {
  // 1) try by ID
  if (/^\d+$/.test(orderRef)) {
    try {
      const byId = await wooFetch(tenantCfg, `/orders/${orderRef}`);
      if (byId && byId.id) return byId;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  // 2) fallback search (by number or general search)
  // Woo core doesn't filter directly by "number"; search will match many fields.
  const list = await wooFetch(tenantCfg, `/orders?search=${encodeURIComponent(orderRef)}&per_page=20&orderby=date&order=desc`);
  if (Array.isArray(list) && list.length) {
    // prefer exact number match if present
    const exact = list.find(o => String(o.number) === String(orderRef));
    return exact || list[0];
  }
  const list2 = await wooFetch(tenantCfg, `/orders?per_page=20&orderby=date&order=desc`);
  const maybe = list2.find(o => String(o.number) === String(orderRef) || String(o.id) === String(orderRef));
  return maybe || null;
}

function maskEmail(email) {
  if (!email) return "";
  const [name, dom] = email.split("@");
  if (!dom) return email;
  return (name.slice(0, 2) + "***") + "@"
    + (dom.slice(0, 1) + "***" + (dom.includes(".") ? dom.slice(dom.indexOf(".")) : ""));
}

function maskPhone(phone) {
  if (!phone) return "";
  return phone.slice(0, 2) + "***" + phone.slice(-2);
}

function toResult(order) {
  const itemsTotal = parseFloat(order.total || "0"); // total including shipping/tax/discounts
  const shippingTotal = (order.shipping_total ?? order.shipping_lines?.reduce((a, s) => a + parseFloat(s.total || "0"), 0) ?? 0);
  const discount = parseFloat(order.discount_total || "0");
  const tax = parseFloat(order.total_tax || "0");

  const billing = order.billing || {};
  const shipping = order.shipping || {};

  return {
    ok: true,
    id: order.id,
    number: String(order.number ?? order.id),
    status: order.status,
    currency: order.currency,
    totals: {
      items_total: itemsTotal.toFixed(2),
      subtotal: null,
      shipping: String(shippingTotal),
      discount: discount.toFixed(2),
      tax: tax.toFixed(2),
    },
    created: order.date_created,
    paid: order.date_paid || null,
    completed: order.date_completed || null,
    customer: {
      email: maskEmail(billing.email),
      name: [billing.first_name, billing.last_name].filter(Boolean).join(" ") || null,
    },
    addresses: {
      billing: {
        first_name: billing.first_name || "",
        last_name: billing.last_name || "",
        company: billing.company || "",
        address_1: billing.address_1 || "",
        address_2: billing.address_2 || "",
        city: billing.city || "",
        state: billing.state || "",
        postcode: billing.postcode || "",
        country: billing.country || "",
        email: maskEmail(billing.email),
        phone: maskPhone(billing.phone),
        billing_company: billing.company || "",
        biling_nip: "", // left empty (custom fields vary by shop)
        billing_first_name: billing.first_name || "",
        billing_address_1: billing.address_1 || "",
      },
      shipping: {
        first_name: shipping.first_name || "",
        last_name: shipping.last_name || "",
        company: shipping.company || "",
        address_1: shipping.address_1 || "",
        address_2: shipping.address_2 || "",
        city: shipping.city || "",
        state: shipping.state || "",
        postcode: shipping.postcode || "",
        country: shipping.country || "",
        phone: maskPhone(billing.phone || ""),
        shipping_address_1: shipping.address_1 || "",
        shipping_phone: "",
      },
    },
    items: (order.line_items || []).map(li => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      qty: li.quantity,
      subtotal: String(li.subtotal),
      total: String(li.total),
      total_tax: String(li.total_tax),
    })),
    shipping_lines: (order.shipping_lines || []).map(s => ({
      method_id: s.method_id,
      method_title: s.method_title,
      total: String(s.total),
      total_tax: String(s.total_tax),
    })),
    tracking: [], // plugin-dependent; left empty
    eta: null,
  };
}

// ---------- Tool definition ----------
function buildToolSchema() {
  const tenants = Object.keys(getWooTenants());
  return {
    name: "getOrderDetails",
    description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
    input_schema: {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "additionalProperties": false,
      "required": ["tenant", "orderRef", "email"],
      "properties": {
        "tenant": { "type": "string", "enum": tenants.length ? tenants : ["demo"] },
        "orderRef": { "type": "string", "description": "ID lub numer zamówienia" },
        "email": { "type": "string", "format": "email" }
      }
    }
  };
}

function listToolsPayload() {
  return { tools: [buildToolSchema()] };
}

async function runGetOrderDetails(args) {
  const { tenant, orderRef, email } = args || {};
  if (!tenant || !orderRef || !email) {
    return { error: "missing_arguments" };
  }
  const tenants = getWooTenants();
  const tcfg = tenants[tenant];
  if (!tcfg) {
    return { error: `unknown_tenant '${tenant}'` };
  }

  const order = await findOrder(tcfg, String(orderRef));
  if (!order || !order.id) {
    return { error: "order_not_found" };
  }

  const orderEmail = (order.billing && (order.billing.email || "")).trim().toLowerCase();
  if (!orderEmail || orderEmail !== String(email).trim().toLowerCase()) {
    return { error: "email_mismatch" };
  }

  return { result: toResult(order) };
}

// ---------- HTTP handler ----------
module.exports = async (req, res) => {
  try {
    cors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname; // e.g. /mcp, /mcp/list_tools, /mcp/tool.call

    if (req.method === "GET" && path === "/mcp") {
      return ok(res, { mcp_version: "1.0", ...listToolsPayload() });
    }

    if ((req.method === "POST" || req.method === "GET") && path === "/mcp/list_tools") {
      return ok(res, listToolsPayload());
    }

    if (req.method === "POST" && path === "/mcp/tool.call") {
      const body = await readJson(req);
      if (!body || typeof body.name !== "string") return bad(res, "invalid_body");

      if (body.name === "getOrderDetails") {
        const out = await runGetOrderDetails(body.arguments || {});
        if (out.error) return ok(res, out);
        return ok(res, out);
      }
      return bad(res, `unknown_tool '${body.name}'`);
    }

    if (req.method === "POST" && path === "/mcp") {
      // Accept POST /mcp as discovery (some clients do this)
      return ok(res, { mcp_version: "1.0", ...listToolsPayload() });
    }

    return notFound(res);
  } catch (e) {
    return serverError(res, e);
  }
};

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve(null); }
    });
  });
}
