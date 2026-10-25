// server.js – Node/Express replacement for the Supabase Edge Function
// ---------------------------------------------------------------
// Run the following commands in the project root:
//   npm install express @supabase/supabase-js dotenv
//   node server.js
// ---------------------------------------------------------------
require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// Servir archivos estáticos (incluyendo index.html)
app.use(express.static(path.join(__dirname)));

// ---------- CORS ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
app.use((req, res, next) => {
  res.set(CORS);
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------- Supabase client ----------
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }
  return createClient(url, key);
}

// ---------- Helper utilities ----------
function jsonRes(res, data, status = 200) {
  return res.status(status).json(data);
}
function errRes(res, msg, status = 400) {
  return jsonRes(res, { error: msg }, status);
}
function generateToken(len = 32) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = crypto.randomBytes(len);
  return Array.from(buf, b => chars[b % chars.length]).join('');
}
async function hashPin(pin, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pin, salt, 100_000, 32, 'sha256');
  return { hash: hash.toString('hex'), salt: salt.toString('base64') };
}
function secureShuffleIds(ids) {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function performSorteo(participants, restrictions) {
  const forbidden = new Set(
    restrictions.flatMap(r => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]),
  );
  for (let t = 0; t < 10_000; t++) {
    const ids = participants.map(p => p.id);
    const shuffled = secureShuffleIds(ids);
    const map = new Map();
    let ok = true;
    for (let i = 0; i < ids.length; i++) {
      const giver = ids[i];
      const receiver = shuffled[i];
      if (giver === receiver || forbidden.has(`${giver}|${receiver}`)) {
        ok = false;
        break;
      }
      map.set(giver, receiver);
    }
    if (ok) return map;
  }
  return null;
}
async function isRateLimited(sb, token) {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await sb
    .from('pin_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('token', token)
    .gte('attempt_time', since);
  return (count ?? 0) >= 5;
}
async function recordAttempt(sb, token) {
  await sb.from('pin_attempts').insert({ token });
}

// ---------- Route handlers (mirroring original Edge Function) ----------
app.post('/event', async (req, res) => {
  const { name, date, budget, participants: names, restrictions: rPairs } = req.body;
  if (!name || typeof name !== 'string' || !name.trim())
    return errRes(res, 'El nombre del evento es requerido');
  if (!Array.isArray(names) || names.length < 3)
    return errRes(res, 'Se necesitan al menos 3 participantes');
  const trimmed = names.map(n => String(n).trim()).filter(Boolean);
  if (new Set(trimmed.map(n => n.toLowerCase())).size !== trimmed.length)
    return errRes(res, 'Hay nombres repetidos en la lista');

  const adminToken = generateToken(40);
  const sb = getSupabase();
  const { data: event, error: eErr } = await sb
    .from('events')
    .insert({ admin_token: adminToken, name: name.trim(), event_date: date || null, budget: budget || null })
    .select()
    .single();
  if (eErr || !event) return errRes(res, 'Error al crear el evento', 500);

  const pRows = trimmed.map(n => ({ event_id: event.id, name: n, token: generateToken(32) }));
  const { data: parts, error: pErr } = await sb.from('participants').insert(pRows).select();
  if (pErr || !parts) {
    await sb.from('events').delete().eq('id', event.id);
    return errRes(res, 'Error al registrar participantes', 500);
  }

  const nameToId = new Map(parts.map(p => [p.name, p.id]));
  const validRestrictions = [];
  if (Array.isArray(rPairs)) {
    for (const r of rPairs) {
      const aId = nameToId.get(r.a);
      const bId = nameToId.get(r.b);
      if (aId && bId) {
        validRestrictions.push({ a: aId, b: bId });
        await sb.from('restrictions').insert({ event_id: event.id, participant_a_id: aId, participant_b_id: bId });
      }
    }
  }

  const assignment = performSorteo(parts.map(p => ({ id: p.id })), validRestrictions);
  if (!assignment) {
    await sb.from('events').delete().eq('id', event.id);
    return errRes(res, 'Con estas restricciones no es posible hacer el sorteo. Quita alguna restricción e intenta de nuevo.', 422);
  }

  await Promise.all(
    [...assignment.entries()].map(([giverId, receiverId]) =>
      sb.from('participants').update({ assigned_to_id: receiverId }).eq('id', giverId),
    ),
  );
  await sb.from('events').update({ sorteo_done: true }).eq('id', event.id);

  return jsonRes(res, {
    adminToken,
    participants: parts.map(p => ({ id: p.id, name: p.name, token: p.token })),
  });
});

app.get('/admin/:token', async (req, res) => {
  const sb = getSupabase();
  const { data: event } = await sb
    .from('events')
    .select('id, name, event_date, budget')
    .eq('admin_token', req.params.token)
    .eq('is_active', true)
    .single();
  if (!event) return errRes(res, 'Enlace de administrador no válido o expirado.', 404);
  const { data: parts } = await sb
    .from('participants')
    .select('id, name, token, has_pin')
    .eq('event_id', event.id)
    .order('created_at', { ascending: true });
  return jsonRes(res, { event, participants: parts ?? [] });
});

app.post('/admin/:token/new-sorteo', async (req, res) => {
  const sb = getSupabase();
  const { data: event } = await sb.from('events').select('id').eq('admin_token', req.params.token).eq('is_active', true).single();
  if (!event) return errRes(res, 'Evento no encontrado', 404);
  const { data: parts } = await sb.from('participants').select('id, name, token').eq('event_id', event.id);
  if (!parts || parts.length < 3) return errRes(res, 'Participantes insuficientes', 400);
  const { data: restr } = await sb.from('restrictions').select('participant_a_id, participant_b_id').eq('event_id', event.id);
  const rPairs = (restr ?? []).map(r => ({ a: r.participant_a_id, b: r.participant_b_id }));
  const assignment = performSorteo(parts, rPairs);
  if (!assignment) return errRes(res, 'Con las restricciones actuales no es posible hacer el sorteo.', 422);

  const oldTokens = parts.map(p => p.token);
  const updated = [];
  for (const p of parts) {
    const newTok = generateToken(32);
    const receiver = assignment.get(p.id);
    await sb.from('participants').update({ token: newTok, pin_hash: null, pin_salt: null, has_pin: false, assigned_to_id: receiver ?? null, wishlist: null }).eq('id', p.id);
    updated.push({ id: p.id, name: p.name, token: newTok, has_pin: false });
  }
  if (oldTokens.length) await sb.from('pin_attempts').delete().in('token', oldTokens);
  return jsonRes(res, { participants: updated });
});

app.get('/participant/:token', async (req, res) => {
  const sb = getSupabase();
  const { data: p } = await sb.from('participants').select('id, name, has_pin, event_id').eq('token', req.params.token).single();
  if (!p) return errRes(res, 'Este enlace no existe o ya no es válido.', 404);
  const { data: ev } = await sb.from('events').select('name, event_date, budget, is_active').eq('id', p.event_id).single();
  if (!ev || !ev.is_active) return errRes(res, 'Este sorteo ya no está activo.', 404);
  return jsonRes(res, { name: p.name, has_pin: p.has_pin, event: { name: ev.name, date: ev.event_date, budget: ev.budget } });
});

app.post('/participant/:token/set-pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(pin)) return errRes(res, 'El PIN debe ser de exactamente 4 dígitos numéricos');
  const sb = getSupabase();
  const { data: p } = await sb.from('participants').select('id, has_pin').eq('token', req.params.token).single();
  if (!p) return errRes(res, 'Enlace no válido', 404);
  if (p.has_pin) return errRes(res, 'Este enlace ya fue reclamado. Si no fuiste tú, avísale al organizador para hacer un sorteo nuevo.', 409);
  const { hash, salt } = await hashPin(pin);
  const { error: uErr } = await sb.from('participants').update({ pin_hash: hash, pin_salt: salt, has_pin: true }).eq('id', p.id).eq('has_pin', false);
  if (uErr) return errRes(res, 'Error al guardar el PIN', 500);
  return jsonRes(res, { success: true });
});

app.post('/participant/:token/verify-pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(pin)) return errRes(res, 'PIN inválido');
  const sb = getSupabase();
  if (await isRateLimited(sb, req.params.token))
    return errRes(res, 'Demasiados intentos fallidos. Espera 5 minutos e intenta de nuevo.', 429);
  const { data: p } = await sb
    .from('participants')
    .select('id, name, pin_hash, pin_salt, has_pin, wishlist, assigned_to_id, event_id')
    .eq('token', req.params.token)
    .single();
  if (!p) return errRes(res, 'Enlace no válido', 404);
  if (!p.has_pin) return errRes(res, 'No se ha establecido un PIN para este enlace', 400);
  const { hash } = await hashPin(pin, p.pin_salt);
  if (hash !== p.pin_hash) {
    await recordAttempt(sb, req.params.token);
    return errRes(res, 'PIN incorrecto. Vuelve a intentarlo.', 401);
  }
  const [{ data: assignedTo }, { data: ev }] = await Promise.all([
    sb.from('participants').select('name, wishlist').eq('id', p.assigned_to_id).single(),
    sb.from('events').select('name, event_date, budget').eq('id', p.event_id).single(),
  ]);
  return jsonRes(res, {
    success: true,
    name: p.name,
    assigned_to: assignedTo?.name ?? null,
    assigned_to_wishlist: assignedTo?.wishlist ?? null,
    event: { name: ev?.name ?? null, date: ev?.event_date ?? null, budget: ev?.budget ?? null },
  });
});

app.post('/participant/:token/wishlist', async (req, res) => {
  const { pin, wishlist } = req.body;
  if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return errRes(res, 'PIN requerido');
  if (!Array.isArray(wishlist) || wishlist.length === 0 || wishlist.length > 5)
    return errRes(res, 'La lista debe tener entre 1 y 5 elementos');
  const sb = getSupabase();
  if (await isRateLimited(sb, req.params.token)) return errRes(res, 'Demasiados intentos. Espera unos minutos.', 429);
  const { data: p } = await sb.from('participants').select('id, pin_hash, pin_salt, has_pin').eq('token', req.params.token).single();
  if (!p || !p.has_pin) return errRes(res, 'Enlace no válido', 404);
  const { hash } = await hashPin(pin, p.pin_salt);
  if (hash !== p.pin_hash) {
    await recordAttempt(sb, req.params.token);
    return errRes(res, 'PIN incorrecto', 401);
  }
  const wishText = wishlist.map(s => String(s).trim()).filter(Boolean).slice(0, 5).join('\n');
  await sb.from('participants').update({ wishlist: wishText }).eq('id', p.id);
  return jsonRes(res, { success: true });
});

// Health check para Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Fallback para SPA (sirve index.html para cualquier otra ruta GET)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
