/* Photo hazard spotting relay for the Site Risk Assessment app.
 * Runs on Cloudflare Workers. Keeps the Anthropic API key off the phone and
 * out of the public GitHub repository.
 *
 * Secrets / variables (set in the Cloudflare dashboard):
 *   ANTHROPIC_API_KEY  (secret, required)
 *   ACCESS_CODE        (secret, recommended) — the code you type into the app's Settings
 *   ALLOWED_ORIGIN     (optional) e.g. https://beanosaur.github.io
 *   MODEL              (optional) defaults to claude-sonnet-5-5
 */

const SYSTEM = `You help a safety officer of the Sealed Knot (an English Civil War reenactment society) risk-assess event sites from photos.
Events include battle reenactment (musket, pike, artillery, cavalry), living history displays and members' camping, with members of the public present.
Only report hazards you can see evidence of in the photo. Do not guess at things you cannot see. Be concise and practical.`;

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'Bad request' }, 400); }
    if (env.ACCESS_CODE && body.code !== env.ACCESS_CODE) return reply({ error: 'Wrong access code' }, 401);
    if (body.ping) return reply({ ok: true });
    if (!env.ANTHROPIC_API_KEY) return reply({ error: 'Relay has no API key set' }, 500);
    if (typeof body.image !== 'string' || !body.image || body.image.length > 5_000_000) {
      return reply({ error: 'Missing or oversized image' }, 400);
    }

    const checklist = (Array.isArray(body.hazards) ? body.hazards : [])
      .slice(0, 400)
      .map((h) => `${String(h.id).slice(0, 60)}: ${String(h.area || '').slice(0, 60)} — ${String(h.hazard || '').slice(0, 160)}`)
      .join('\n');
    const activities = (Array.isArray(body.activities) ? body.activities : []).join(', ') || 'not stated';
    const note = String(body.note || '').slice(0, 500);

    const prompt = `Activities on this site: ${activities}
${note ? `Assessor's note on this photo: ${note}\n` : ''}
Hazard checklist (id: area — hazard):
${checklist || '(none)'}

List the hazards you can see in this photo, at most 8, most serious first.
For each give:
- "hazardId": the matching checklist id, or null if nothing on the checklist fits
- "title": short hazard name (required when hazardId is null)
- "who": who could be harmed (only when hazardId is null)
- "controls": sensible controls (only when hazardId is null)
- "reason": what in the photo shows it, under 20 words
- "x", "y": where it is in the image, as percentages from the left and top (0-100)

Reply with JSON only, in this shape: {"suggestions":[{"hazardId":null,"title":"","who":"","controls":"","reason":"","x":50,"y":50}]}
If you see no hazards, reply {"suggestions":[]}.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5-5',
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return reply({ error: (data.error && data.error.message) || 'AI service error ' + res.status }, 502);

    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    let parsed;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
    catch { return reply({ error: 'Could not read the AI reply' }, 502); }

    const ids = new Set((Array.isArray(body.hazards) ? body.hazards : []).map((h) => String(h.id)));
    const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, v)) : undefined);
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).slice(0, 8).map((s) => ({
      hazardId: s.hazardId && ids.has(String(s.hazardId)) ? String(s.hazardId) : null,
      title: String(s.title || '').slice(0, 120),
      who: String(s.who || '').slice(0, 120),
      controls: String(s.controls || '').slice(0, 400),
      reason: String(s.reason || '').slice(0, 200),
      x: num(s.x),
      y: num(s.y),
    })).filter((s) => s.hazardId || s.title);

    return reply({ suggestions });
  },
};
