function setCors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCors(res, 'POST,OPTIONS'); res.status(204).end(); return;
  }
  if (req.method !== 'POST') {
    setCors(res, 'POST,OPTIONS'); res.status(405).json({ error: 'method_not_allowed' }); return;
  }

  setCors(res, 'POST,OPTIONS');

  try {
    const { name, arguments: args } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (name !== 'getOrderDetails') {
      return res.status(400).json({ error: 'unknown_tool' });
    }
    // --- tu zostawiasz swoją logikę; poniżej zwrotka OK do testów:
    return res.status(200).json({
      result: {
        ok: true,
        id: Number(args?.orderRef) || 0,
        number: String(args?.orderRef || ''),
        status: "completed",
        currency: "PLN",
        totals: { items_total: "0.00", subtotal: null, shipping: "0.00", discount: "0.00", tax: "0.00" },
        created: new Date().toISOString(),
        paid: new Date().toISOString(),
        completed: new Date().toISOString(),
        customer: { email: "ma***@sk***", name: "Demo User" },
        addresses: { billing: {}, shipping: {} },
        items: [],
        shipping_lines: [],
        tracking: [],
        eta: null
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'FUNCTION_INVOCATION_FAILED', detail: String(e?.message || e) });
  }
}
