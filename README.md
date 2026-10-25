# 🎁 Sorteo Familiar — Guía de publicación paso a paso

## ¿Qué se crearon?

| Archivo | Para qué sirve |
|---------|---------------|
| `index.html` | La página web completa (frontend) |
| `supabase/migrations/001_schema.sql` | Crea las tablas en la base de datos |
| `supabase/functions/api/index.ts` | El servidor privado que guarda los resultados |

> **El organizador NUNCA ve los resultados.** El servidor solo entrega el resultado al participante que tiene el enlace correcto Y su PIN correcto.

---

## PASO 1 — Crear cuenta en Supabase (gratis)

1. Ve a **https://supabase.com** y crea una cuenta con tu correo de Google o GitHub (no necesitas tarjeta).
2. Haz clic en **"New project"**.
3. Elige un nombre (ej. `sorteo-familiar`), una contraseña para la base de datos (guárdala), y la región **`us-east-1`** (la más cercana a México).
4. Espera ~2 minutos a que el proyecto termine de crearse.

---

## PASO 2 — Crear las tablas en la base de datos

1. En el panel de Supabase, ve al menú izquierdo → **SQL Editor**.
2. Haz clic en **"New query"**.
3. Abre el archivo `supabase/migrations/001_schema.sql` y **copia todo su contenido**.
4. Pégalo en el SQL Editor y haz clic en **"Run"** (▶️).
5. Deberías ver el mensaje `Success. No rows returned.`

---

## PASO 3 — Instalar Supabase CLI y Deno

Abre una terminal (PowerShell) y ejecuta:

```powershell
# Instalar Supabase CLI
npm install -g supabase

# Verificar instalación
supabase --version
```

Si no tienes Node.js, descárgalo en: https://nodejs.org

---

## PASO 4 — Conectar tu proyecto local con Supabase

En la terminal, **dentro de la carpeta del proyecto** (`sorteo-familiar`):

```powershell
# Iniciar sesión
supabase login

# Obtener el ID de tu proyecto
# Ve a: supabase.com → tu proyecto → Settings → General
# Copia el "Project ID" (algo como: abcdefghijklm)

# Conectar
supabase link --project-ref TU-PROJECT-ID
```

---

## PASO 5 — Publicar la Edge Function (el servidor)

```powershell
# Desde la carpeta sorteo-familiar:
supabase functions deploy api --no-verify-jwt
```

Cuando termine, copia la URL que te muestra. Tendrá este formato:
```
https://TU-PROJECT-ID.supabase.co/functions/v1/api
```

---

## PASO 6 — Actualizar la URL en index.html

1. Abre `index.html` con cualquier editor de texto (puedes usar el Bloc de notas).
2. Busca esta línea (está cerca de la línea 650):
   ```javascript
   const API = 'https://TU-PROYECTO.supabase.co/functions/v1/api';
   ```
3. Reemplaza `TU-PROYECTO` con tu Project ID real. Ejemplo:
   ```javascript
   const API = 'https://abcdefghijklm.supabase.co/functions/v1/api';
   ```
4. Guarda el archivo.

---

## PASO 7 — Publicar index.html en Netlify (gratis, sin cuenta de pago)

1. Ve a **https://netlify.com** y crea una cuenta gratis.
2. En el Dashboard, busca el recuadro que dice **"Drag and drop your site folder here"**.
3. Arrastra **solo el archivo `index.html`** a ese recuadro (no la carpeta completa).
4. Netlify te dará una URL como `https://nombre-aleatorio.netlify.app`.
5. Opcionalmennte puedes personalizar el nombre en: Site configuration → Change site name.

¡Esa URL es la que compartes con tu familia por WhatsApp!

---

## Alternativa: GitHub Pages (también gratis)

1. Crea una cuenta en https://github.com
2. Crea un repositorio nuevo (público)
3. Sube solo `index.html`
4. Ve a Settings → Pages → Source: "Deploy from branch" → `main` → `/root`
5. Tu URL será: `https://TU-USUARIO.github.io/TU-REPO/`

---

## ✅ Verificación antes de compartir con la familia

Prueba esto antes de enviarlo:

1. **Abre la URL** y crea un sorteo de prueba con 3 nombres ficticios.
2. **Copia el enlace** de uno de los participantes y ábrelo en modo incógnito.
3. Crea un PIN → verás a quién le toca.
4. Cierra y vuelve a abrir ese enlace → debe pedir el PIN de nuevo.
5. Ingresa un PIN incorrecto → debe rechazarlo con mensaje amable.
6. Ingresa 5 PINs incorrectos → debe bloquearlo por 5 minutos.
7. **Abre el panel de admin** → confirma que NO aparecen los resultados, solo nombres y estados.
8. Copia el enlace de otro participante y ábrelo sin PIN → no debe mostrar nada sensible.

---

## Preguntas frecuentes

**¿El organizador puede ver los resultados?**
No. Ni abriendo los enlaces de los participantes. El servidor solo entrega el resultado después de verificar el PIN, que solo la persona sabe.

**¿Qué pasa si alguien olvida su PIN?**
No hay forma de recuperarlo (es parte de la seguridad). El organizador debe hacer clic en "Hacer sorteo nuevo", lo que genera nuevos enlaces y anula todos los PINs anteriores.

**¿Es seguro?**
- Los PINs se guardan con hash PBKDF2-SHA256 (100,000 iteraciones) con sal aleatoria. Nunca en texto claro.
- Después de 5 intentos incorrectos, el enlace se bloquea 5 minutos.
- Los resultados nunca viajan al navegador del organizador.
- Los tokens de los enlaces tienen 32 caracteres aleatorios criptográficos.

**¿Cuántos participantes soporta?**
El tier gratuito de Supabase soporta hasta 500 MB de base de datos y 2 millones de peticiones/mes. Para uso familiar es más que suficiente.

**¿La lista de deseos es obligatoria?**
No, es opcional. Cada participante puede añadirla o no después de ver su resultado.
