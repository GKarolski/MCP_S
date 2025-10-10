// api/mcp/index.js
const TOOLS = [/* …twoja definicja getOrderDetails… */];

function setCORS(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods.join(','));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default function handler(req, res) {
  setCORS(res, ['GET','HEAD','OPTIONS']);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'HEAD')    return res.status(200).end();

  const payload = { mcp_version: '1.0', tools: TOOLS };

  // Fallback: niektóre hosty proszą o SSE
  if ((req.headers.accept || '').includes('text/event-stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: mcp_list_tools\n`);
    res.write(`data: ${JSON.stringify({ tools: TOOLS })}\n\n`);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json(payload);
}
