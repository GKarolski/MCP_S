export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = req.body || {};
  const toolName = (body.name === 'getOrderDetails') ? 'get_order_details' : body.name; // wsteczna zgodność
  const args = body.arguments || {};

  if (toolName !== 'get_order_details') return res.status(404).json({ error: 'unknown_tool' });
  const { tenant, orderRef, email } = args;
  if (!tenant || !orderRef || !email) return res.status(400).json({ error: 'invalid_arguments' });
  if (tenant !== 'demo') return res.status(400).json({ error: 'unsupported_tenant' });

  // DEMO stub – zwraca to, co już testowałeś. Podmień na realne wywołanie Woo, jeśli chcesz.
  if (orderRef === '266600' && email === 'kilian.patryk@o2.pl') {
    return res.status(200).json({
      result: {
        ok: true,
        id: 266600,
        number: "266600",
        status: "completed",
        currency: "PLN",
        totals: { items_total: "417.99", subtotal: null, shipping: "18.99", discount: "0.00", tax: "0.00" },
        created: "2025-10-09T12:55:46",
        paid: "2025-10-09T12:59:48",
        completed: "2025-10-09T12:59:48",
        customer: { email: "ki***@o***l", name: "Patryk Kilian" },
        addresses: {
          billing: {
            first_name: "Patryk", last_name: "Kilian", company: "",
            address_1: "Nowe przybojewo 35", address_2: "",
            city: "Czerwinsk nad wisla", state: "", postcode: "09-150", country: "PL",
            email: "ki***@o***l", phone: "79***64",
            billing_company: "", biling_nip: "", billing_first_name: "Patryk", billing_address_1: "Nowe przybojewo 35"
          },
          shipping: {
            first_name: "Patryk", last_name: "Kilian", company: "",
            address_1: "Nowe przybojewo 35", address_2: "",
            city: "Czerwinsk nad wisla", state: "", postcode: "09-150", country: "PL",
            phone: "79***64", shipping_address_1: "Nowe przybojewo 35", shipping_phone: ""
          }
        },
        items: [{ id: 9353, name: "adidas NMD R1 Primeblue Triple Black", sku: "GZ9256", qty: 1, subtotal: "399.00", total: "399.00", total_tax: "0.00" }],
        shipping_lines: [{ method_id: "flexible_shipping_single", method_title: "DPD Kurier Pobranie", total: "18.99", total_tax: "0.00" }],
        tracking: [{ tracking_number: "1027173841792U", provider: "dpd-pl", link: null, date_shipped: "1759968000" }],
        eta: null
      }
    });
  }

  return res.status(200).json({ result: { ok: false, error: 'demo_has_only_order_266600' } });
}
