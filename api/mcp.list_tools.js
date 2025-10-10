function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
}

export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Minimalna odpowiedź „remote MCP list_tools”
  res.json({
    tools: [
      {
        name: "getOrderDetails",
        description: "Zwraca dane zamówienia Woo po ID lub numerze; weryfikuje email.",
        input_schema: {
          "$schema": "https://json-schema.org/draft/2020-12/schema",
          "type": "object",
          "additionalProperties": false,
          "required": ["tenant","orderRef","email"],
          "properties": {
            "tenant":  { "type": "string", "enum": ["demo"] },
            "orderRef":{ "type": "string", "description": "ID lub numer zamówienia" },
            "email":   { "type": "string", "format": "email" }
          }
        }
      }
    ]
  });
}
