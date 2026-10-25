/// <reference lib="deno.ns" />
/// <reference lib="dom" />
import "https://deno.land/std/dotenv/load.ts";

// SORTEO FAMILIAR — Supabase Edge Function
// Archivo: supabase/functions/api/index.ts
// ============================================================
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getSupabase(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function errRes(msg: string, status = 400): Response {
  return jsonRes({ error: msg }, status);
}

// ============================================================
// CRYPTO HELPERS
// ============================================================

/** Token alfanumérico criptográficamente seguro */
function generateToken(len = 32): string {
  const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => CHARS[b % CHARS.length]).join("");
}

/** Hash del PIN con PBKDF2-SHA256, 100,000 iteraciones */
async function hashPin(
  pin: string,
  saltB64?: string,
): Promise<{ hash: string; salt: string }> {
  const enc = new TextEncoder();
  let salt: Uint8Array;

  if (saltB64) {
    salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  } else {
    salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    key,
    256,
  );

  const hash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const newSalt = btoa(String.fromCharCode(...salt));

  return { hash, salt: newSalt };
}

/** Shuffle criptográficamente seguro (Fisher-Yates) */
function secureShuffleIds(ids: string[]): string[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Realiza el sorteo como papelitos en una bolsa.
 * Descarta y repite si alguien se saca a sí mismo o viola una restricción.
 * Máximo 10,000 intentos.
 */
function performSorteo(
  participants: { id: string }[],
  restrictions: { a: string; b: string }[],
): Map<string, string> | null {
  const forbidden = new Set(
    restrictions.flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]),
  );

  for (let t = 0; t < 10_000; t++) {
    const ids = participants.map((p) => p.id);
    const shuffled = secureShuffleIds(ids);
    const map = new Map<string, string>();
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

  return null; // Imposible con estas restricciones
}

// ============================================================
// RATE LIMITING (5 intentos / 5 minutos por token)
// ============================================================

async function isRateLimited(
  sb: SupabaseClient,
  token: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await sb
    .from("pin_attempts")
    .select("*", { count: "exact", head: true })
    .eq("token", token)
    .gte("attempt_time", since);
  return (count ?? 0) >= 5;
}

async function recordAttempt(sb: SupabaseClient, token: string) {
  await sb.from("pin_attempts").insert({ token });
}

// ============================================================
// HANDLER: POST /event — Crear evento + sorteo
// ============================================================
async function handleCreateEvent(
  sb: SupabaseClient,
  body: unknown,
): Promise<Response> {
  const { name, date, budget, participants: names, restrictions: rPairs } =
    body as Record<string, unknown>;

  if (!name || typeof name !== "string" || !name.trim()) {
    return errRes("El nombre del evento es requerido");
  }
  if (!Array.isArray(names) || names.length < 3) {
    return errRes("Se necesitan al menos 3 participantes");
  }

  const trimmed: string[] = names.map((n: unknown) => String(n).trim()).filter(
    Boolean,
  );
  const lower = trimmed.map((n) => n.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    return errRes("Hay nombres repetidos en la lista");
  }

  const adminToken = generateToken(40);

  // Crear evento
  const { data: event, error: eErr } = await sb
    .from("events")
    .insert({
      admin_token: adminToken,
      name: (name as string).trim(),
      event_date: date || null,
      budget: budget || null,
    })
    .select()
    .single();

  if (eErr || !event) return errRes("Error al crear el evento", 500);

  // Crear participantes
  const pRows = trimmed.map((n) => ({
    event_id: event.id,
    name: n,
    token: generateToken(32),
  }));

  const { data: parts, error: pErr } = await sb
    .from("participants")
    .insert(pRows)
    .select();

  if (pErr || !parts) {
    await sb.from("events").delete().eq("id", event.id);
    return errRes("Error al registrar participantes", 500);
  }

  // Guardar restricciones
  const nameToId = new Map(
    parts.map((p: Record<string, string>) => [p.name, p.id]),
  );
  const validRestrictions: { a: string; b: string }[] = [];

  if (Array.isArray(rPairs)) {
    for (const r of rPairs as Array<{ a: string; b: string }>) {
      const aId = nameToId.get(r.a);
      const bId = nameToId.get(r.b);
      if (aId && bId) {
        validRestrictions.push({ a: aId, b: bId });
        await sb.from("restrictions").insert({
          event_id: event.id,
          participant_a_id: aId,
          participant_b_id: bId,
        });
      }
    }
  }

  // Realizar sorteo
  const assignment = performSorteo(
    parts.map((p: Record<string, string>) => ({ id: p.id })),
    validRestrictions,
  );

  if (!assignment) {
    await sb.from("events").delete().eq("id", event.id);
    return errRes(
      "Con estas restricciones no es posible hacer el sorteo. Quita alguna restricción e intenta de nuevo.",
      422,
    );
  }

  // Guardar asignaciones
  await Promise.all(
    [...assignment.entries()].map(([giverId, receiverId]) =>
      sb.from("participants").update({ assigned_to_id: receiverId }).eq(
        "id",
        giverId,
      )
    ),
  );

  await sb.from("events").update({ sorteo_done: true }).eq("id", event.id);

  return jsonRes({
    adminToken,
    participants: parts.map((p: Record<string, string>) => ({
      id: p.id,
      name: p.name,
      token: p.token,
    })),
  });
}

// ============================================================
// HANDLER: GET /admin/:token — Vista del organizador
// NUNCA devuelve resultados del sorteo
// ============================================================
async function handleGetAdmin(
  sb: SupabaseClient,
  adminToken: string,
): Promise<Response> {
  const { data: event } = await sb
    .from("events")
    .select("id, name, event_date, budget")
    .eq("admin_token", adminToken)
    .eq("is_active", true)
    .single();

  if (!event) {
    return errRes("Enlace de administrador no válido o expirado.", 404);
  }

  const { data: parts } = await sb
    .from("participants")
    .select("id, name, token, has_pin")
    .eq("event_id", event.id)
    .order("created_at", { ascending: true });

  // IMPORTANTE: nunca se incluye assigned_to_id ni ningún resultado
  return jsonRes({
    event: {
      id: event.id,
      name: event.name,
      date: event.event_date,
      budget: event.budget,
    },
    participants: (parts ?? []).map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      token: p.token,
      has_pin: p.has_pin,
    })),
  });
}

// ============================================================
// HANDLER: POST /admin/:token/new-sorteo — Sorteo nuevo
// ============================================================
async function handleNewSorteo(
  sb: SupabaseClient,
  adminToken: string,
): Promise<Response> {
  const { data: event } = await sb
    .from("events")
    .select("id")
    .eq("admin_token", adminToken)
    .eq("is_active", true)
    .single();

  if (!event) return errRes("Evento no encontrado", 404);

  const { data: parts } = await sb
    .from("participants")
    .select("id, name, token")
    .eq("event_id", event.id);

  if (!parts || parts.length < 3) {
    return errRes("Participantes insuficientes", 400);
  }

  const { data: restr } = await sb
    .from("restrictions")
    .select("participant_a_id, participant_b_id")
    .eq("event_id", event.id);

  const rPairs = (restr ?? []).map((r: Record<string, string>) => ({
    a: r.participant_a_id,
    b: r.participant_b_id,
  }));

  const assignment = performSorteo(parts, rPairs);
  if (!assignment) {
    return errRes(
      "Con las restricciones actuales no es posible hacer el sorteo.",
      422,
    );
  }

  const oldTokens = parts.map((p: Record<string, string>) => p.token);
  const updated: Array<
    { id: string; name: string; token: string; has_pin: boolean }
  > = [];

  for (const p of parts as Array<{ id: string; name: string; token: string }>) {
    const newTok = generateToken(32);
    const receiver = assignment.get(p.id);
    await sb.from("participants").update({
      token: newTok,
      pin_hash: null,
      pin_salt: null,
      has_pin: false,
      assigned_to_id: receiver ?? null,
      wishlist: null,
    }).eq("id", p.id);
    updated.push({ id: p.id, name: p.name, token: newTok, has_pin: false });
  }

  // Limpiar intentos de PIN anteriores
  if (oldTokens.length > 0) {
    await sb.from("pin_attempts").delete().in("token", oldTokens);
  }

  return jsonRes({ participants: updated });
}

// ============================================================
// HANDLER: GET /participant/:token — Info del participante
// NUNCA devuelve el resultado
// ============================================================
async function handleGetParticipant(
  sb: SupabaseClient,
  token: string,
): Promise<Response> {
  const { data: p } = await sb
    .from("participants")
    .select("id, name, has_pin, event_id")
    .eq("token", token)
    .single();

  if (!p) return errRes("Este enlace no existe o ya no es válido.", 404);

  const { data: ev } = await sb
    .from("events")
    .select("name, event_date, budget, is_active")
    .eq("id", (p as Record<string, unknown>).event_id)
    .single();

  if (!ev || !(ev as Record<string, unknown>).is_active) {
    return errRes("Este sorteo ya no está activo.", 404);
  }

  return jsonRes({
    name: (p as Record<string, unknown>).name,
    has_pin: (p as Record<string, unknown>).has_pin,
    event: {
      name: (ev as Record<string, unknown>).name,
      date: (ev as Record<string, unknown>).event_date,
      budget: (ev as Record<string, unknown>).budget,
    },
  });
}

// ============================================================
// HANDLER: POST /participant/:token/set-pin — Crear PIN (1a vez)
// ============================================================
async function handleSetPin(
  sb: SupabaseClient,
  token: string,
  body: unknown,
): Promise<Response> {
  const { pin } = body as Record<string, string>;
  if (!pin || !/^\d{4}$/.test(pin)) {
    return errRes("El PIN debe ser de exactamente 4 dígitos numéricos");
  }

  const { data: p } = await sb
    .from("participants")
    .select("id, has_pin")
    .eq("token", token)
    .single();

  if (!p) return errRes("Enlace no válido", 404);

  if ((p as Record<string, unknown>).has_pin) {
    return errRes(
      "Este enlace ya fue reclamado. Si no fuiste tú, avísale al organizador para hacer un sorteo nuevo.",
      409,
    );
  }

  const { hash, salt } = await hashPin(pin);

  // Condición extra en la cláusula WHERE para evitar race conditions
  const { error: uErr } = await sb
    .from("participants")
    .update({ pin_hash: hash, pin_salt: salt, has_pin: true })
    .eq("id", (p as Record<string, unknown>).id)
    .eq("has_pin", false);

  if (uErr) return errRes("Error al guardar el PIN", 500);

  return jsonRes({ success: true });
}

// ============================================================
// HANDLER: POST /participant/:token/verify-pin — Verificar PIN
// Solo aquí se devuelve el resultado, y solo al dueño del enlace
// ============================================================
async function handleVerifyPin(
  sb: SupabaseClient,
  token: string,
  body: unknown,
): Promise<Response> {
  const { pin } = body as Record<string, string>;
  if (!pin || !/^\d{4}$/.test(pin)) return errRes("PIN inválido");

  if (await isRateLimited(sb, token)) {
    return errRes(
      "Demasiados intentos fallidos. Espera 5 minutos e intenta de nuevo.",
      429,
    );
  }

  const { data: p } = await sb
    .from("participants")
    .select(
      "id, name, pin_hash, pin_salt, has_pin, wishlist, assigned_to_id, event_id",
    )
    .eq("token", token)
    .single();

  if (!p) return errRes("Enlace no válido", 404);
  if (!(p as Record<string, unknown>).has_pin) {
    return errRes("No se ha establecido un PIN para este enlace", 400);
  }

  const pr = p as Record<string, string | boolean | null>;
  const { hash } = await hashPin(pin, pr.pin_salt as string);

  if (hash !== pr.pin_hash) {
    await recordAttempt(sb, token);
    return errRes("PIN incorrecto. Vuelve a intentarlo.", 401);
  }

  // PIN correcto — consultar asignación y evento en paralelo
  const [{ data: assignedTo }, { data: ev }] = await Promise.all([
    sb.from("participants").select("name, wishlist").eq(
      "id",
      pr.assigned_to_id as string,
    ).single(),
    sb.from("events").select("name, event_date, budget").eq(
      "id",
      pr.event_id as string,
    ).single(),
  ]);

  const at = assignedTo as Record<string, string | null> | null;
  const e = ev as Record<string, string | null> | null;

  return jsonRes({
    success: true,
    name: pr.name,
    assigned_to: at?.name ?? null,
    assigned_to_wishlist: at?.wishlist ?? null,
    event: {
      name: e?.name ?? null,
      date: e?.event_date ?? null,
      budget: e?.budget ?? null,
    },
  });
}

// ============================================================
// HANDLER: POST /participant/:token/wishlist — Guardar lista de deseos
// ============================================================
async function handleSetWishlist(
  sb: SupabaseClient,
  token: string,
  body: unknown,
): Promise<Response> {
  const { pin, wishlist } = body as Record<string, unknown>;
  if (!pin || typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    return errRes("PIN requerido");
  }
  if (
    !Array.isArray(wishlist) || wishlist.length === 0 || wishlist.length > 5
  ) {
    return errRes("La lista debe tener entre 1 y 5 elementos");
  }

  if (await isRateLimited(sb, token)) {
    return errRes("Demasiados intentos. Espera unos minutos.", 429);
  }

  const { data: p } = await sb
    .from("participants")
    .select("id, pin_hash, pin_salt, has_pin")
    .eq("token", token)
    .single();

  const pr = p as Record<string, string | boolean | null> | null;
  if (!pr || !pr.has_pin) return errRes("Enlace no válido", 404);

  const { hash } = await hashPin(pin, pr.pin_salt as string);
  if (hash !== pr.pin_hash) {
    await recordAttempt(sb, token);
    return errRes("PIN incorrecto", 401);
  }

  const wishText = (wishlist as string[])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 5)
    .join("\n");

  await sb.from("participants").update({ wishlist: wishText }).eq("id", pr.id);

  return jsonRes({ success: true });
}

// ============================================================
// ROUTER PRINCIPAL
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  // Formato de URL: /functions/v1/api/[...segmentos]
  const apiIdx = parts.lastIndexOf("api");
  const seg = apiIdx >= 0 ? parts.slice(apiIdx + 1) : parts;

  const sb = getSupabase();

  try {
    // POST /event
    if (seg[0] === "event" && !seg[1] && req.method === "POST") {
      return await handleCreateEvent(sb, await req.json());
    }

    // GET /admin/:token
    if (seg[0] === "admin" && seg[1] && !seg[2] && req.method === "GET") {
      return await handleGetAdmin(sb, seg[1]);
    }

    // POST /admin/:token/new-sorteo
    if (
      seg[0] === "admin" && seg[1] && seg[2] === "new-sorteo" &&
      req.method === "POST"
    ) {
      return await handleNewSorteo(sb, seg[1]);
    }

    // GET /participant/:token
    if (seg[0] === "participant" && seg[1] && !seg[2] && req.method === "GET") {
      return await handleGetParticipant(sb, seg[1]);
    }

    // POST /participant/:token/set-pin
    if (
      seg[0] === "participant" && seg[1] && seg[2] === "set-pin" &&
      req.method === "POST"
    ) {
      return await handleSetPin(sb, seg[1], await req.json());
    }

    // POST /participant/:token/verify-pin
    if (
      seg[0] === "participant" && seg[1] && seg[2] === "verify-pin" &&
      req.method === "POST"
    ) {
      return await handleVerifyPin(sb, seg[1], await req.json());
    }

    // POST /participant/:token/wishlist
    if (
      seg[0] === "participant" && seg[1] && seg[2] === "wishlist" &&
      req.method === "POST"
    ) {
      return await handleSetWishlist(sb, seg[1], await req.json());
    }

    return errRes("Ruta no encontrada", 404);
  } catch (e) {
    console.error("Error en edge function:", e);
    return errRes("Error interno del servidor. Intenta de nuevo.", 500);
  }
});
