// api/mcp/index.js

// CORS + helpers
const json = (res, code, data) => {
  res.status(code).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
};
const cors = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,authorization,openai-mcp-action,x-openai-mcp-action"
  );
};

// Lista narzędzi widoczna dla MCP
const TOOLS = [
  {
    name: "getOrderDetails",
    description:
      "Pobiera szczegóły zamówienia z WooCommerce (tenant + orderRef + email).",
    input_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        tenant: { type: "string", description: "Id Twojej instancji (np. 'shop1')" },
        orderRef: { type: "string", description: "Numer lub ID zamówienia" },
        email: { type: "string", format: "email", description: "E-mail klienta (walidacja)" }
      },
      required: ["tenant", "orderRef", "email"],
      additionalProperties: false
    }
  }
];

// ---- Woo helper ----
const getTenantCfg = (tenantRaw) => {
  const T = String(tenantRaw || "").trim().toUpperCase();
  const baseUrl = process.env[`WOO_${T}_URL`];     // np. https://example.com
  const key     = process.env[`WOO_${T}_KEY`];     // consumer_key
  const secret  = process.env[`WOO_${T}_SECRET`];  // consumer_secret
  if (!baseUrl || !key || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), key, secret };
};

const sum = (arr, pick) =>
  arr.reduce((acc, it) => acc + (parseFloat(pick(it) || "0") || 0), 0);
const asMoney = (n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

// Główna logika narzędzia
async function getOrderDetails({ tenant, orderRef, email }) {
  const cfg = getTenantCfg(tenant);
  if (!cfg) {
    return {
      ok: false,
      error: "config_missing",
      message: `Brak konfiguracji środowiska dla tenanta '${tenant}'.`
    };
  }

  const q = new URLSearchParams({
    consumer_key: cfg.key,
    consumer_secret: cfg.secret,
    per_page: "20",
    search: String(orderRef)
  });

  // 1) szukamy po search
  const listResp = await fetch(`${cfg.baseUrl}/wp-json/wc/v3/orders?${q.toString()}`);
  if (!listResp.ok) {
    const text = await listResp.text().catch(() => "");
    return { ok: false, error: "upstream", status: listResp.status, body: text };
  }
  const orders = await listResp.json();

  const normEmail = String(email).trim().toLowerCase();
  let match =
    orders.find(
      (o) =>
        (String(o.number) === String(orderRef) || String(o.id) === String(orderRef)) &&
        String(o?.billing?.email || "").toLowerCase() === normEmail
    ) || null;

  // 2) fallback: jeśli wygląda na ID – spróbuj GET /orders/{id}
  if (!match && /^\d+$/.test(String(orderRef))) {
    const oneResp = await fetch(
      `${cfg.baseUrl}/wp-json/wc/v3/orders/${orderRef}?${q.toString()}`
    );
    if (oneResp.ok) {
      const one = await oneResp.json();
      if (String(one?.billing?.email || "").toLowerCase() === normEmail) {
        match = one;
      }
    }
  }

  if (!match) {
    return {
      ok: false,
      error: "not_found",
      message: "Nie znaleziono zamówienia dla podanych danych (orderRef/email)."
    };
  }

  // Policz podstawowe sumy
  const itemsTotal = sum(match.line_items || [], (it) => it.total);
  const shippingTotal = sum(match.shipping_lines || [], (s) => s.total);
  const discount = sum(match.coupon_lines || [], (c) => c.discount);
  const tax = sum(match.tax_lines || [], (t) => t.tax_total);

  // Zwracamy schludną strukturę
  return {
    ok: true,
    id: match.id,
    number: match.number,
    status: match.status,
    currency: match.currency,
    totals: {
      items_total: asMoney(itemsTotal),
      shipping: asMoney(shippingTotal),
      discount: asMoney(discount),
      tax: asMoney(tax)
    },
    created: match.date_created,
    paid: match.date_paid || null,
    completed: match.date_completed || null,
    customer: {
      email: match?.billing?.email || null,
      name: `${match?.billing?.first_name || ""} ${match?.billing?.last_name || ""}`.trim()
    },
    addresses: {
      billing: match.billing || null,
      shipping: match.shipping || null
    },
    items: (match.line_items || []).map((it) => ({
      id: it.id,
      name: it.name,
      sku: it.sku,
      qty: it.quantity,
      subtotal: it.subtotal,
      total: it.total,
      total_tax: it.total_tax
    })),
    shipping_lines: (match.shipping_lines || []).map((s) => ({
      method_id: s.method_id,
      method_title: s.method_title,
      total: s.total,
      total_tax: s.total_tax
    }))
    // jeśli masz tracking w meta_data – tu możesz go wypakować
  };
}

// Map narzędzi
const HANDLERS = { getOrderDetails };

// MCP endpoint (list_tools + call_tool w jednym /mcp)
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body || "{}"); } catch { body = {}; }

  const hdr = req.headers["openai-mcp-action"] || req.headers["x-openai-mcp-action"];
  const isCall = !!body?.name || String(hdr || "").toLowerCase() === "call_tool";

  if (!isCall) {
    // LIST TOOLS
    return json(res, 200, { tools: TOOLS });
  }

  // CALL TOOL
  const { name, arguments: args } = body || {};
  const fn = HANDLERS[name];
  if (!fn) {
    return json(res, 200, { output: JSON.stringify({ ok: false, error: "unknown_tool", name }) });
  }

  try {
    const result = await fn(args || {});
    return json(res, 200, { output: JSON.stringify(result) });
  } catch (e) {
    return json(res, 200, {
      output: JSON.stringify({ ok: false, error: "tool_failed", message: e?.message || "Unknown error" })
    });
  }
}
