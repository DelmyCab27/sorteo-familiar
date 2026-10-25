# ==== START OF SCRIPT =====================================================
#  Deploy automático para el proyecto "Sorteo Familiar" con Supabase
#  1️⃣ Necesitas dos datos:
#     • ProjectId           – la parte que aparece en la URL de tu proyecto:
#                           https://<ProjectId>.supabase.co
#     • ServiceRoleKey     – la clave de “Service role” que está en
#                           Supabase → Settings → API → Service role
#  2️⃣ El script:
#     – linkea el proyecto,
#     – exporta la variable de entorno,
#     – despliega la Edge Function,
#     – actualiza index.html con la URL de la API,
#     – muestra la URL pública de la API y un comando listo para subir
#       index.html a Netlify (o a GitHub Pages).
#
#  ¡Ejecuta este script una sola vez y listo! 🎉
# ===========================================================================

# ------------------- CONFIGURACIÓN (RELLENA AQUÍ -------------------------
# <<<--- RELLENA ESTO CON TUS VALORES ---------------------->>> 
$ProjectId   = "oggqrphawryhdumbmxjy"          # ej: abcdefg123
$ServiceRole = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ3FycGhhd3J5aGR1bWJteGp5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjkwMDQ5NiwiZXhwIjoyMTA4NDc2NDk2fQ.0LleDP_dZ0GaRPNJxtiqU11JSwCpDR0NILcidtyiSL4"   # pega la cadena completa (empieza con eyJhbGci...)
# <<<---------------------------------------------------------->>> 
# -------------------------------------------------------------------------

# ------------------- COMPROBACIONES ------------------------------------
if ($ProjectId -eq "<TU_PROJECT_ID>" -or $ProjectId -eq "") {
    Write-Host "`n[❌] ERROR: No has reemplazado $ProjectId. Edita el script y pon tu Project ID."
    exit 1
}
if ($ServiceRole -eq "<TU_SERVICE_ROLE_KEY>" -or $ServiceRole -eq "") {
    Write-Host "`n[❌] ERROR: No has reemplazado $ServiceRole. Edita el script y pon tu Service‑role key."
    exit 1
}
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "`n[❌] ERROR: No se encontró la CLI de Supabase. Instálala con: npm install -g supabase"
    exit 1
}
# -------------------------------------------------------------------------

# ------------------- 1️⃣ Login (solo la primera vez) --------------------
Write-Host "`n[INFO] Asegúrate de haber iniciado sesión en Supabase CLI antes de ejecutar este script."
# supabase login (se omite en modo no interactivo)

# ------------------- 2️⃣ Vincular proyecto --------------------------------
Write-Host "`n[🔗] Vinculando carpeta al proyecto $ProjectId ..."
supabase link --project-ref $ProjectId | Out-Null
Write-Host "[✅] Proyecto vinculado."

# ------------------- 3️⃣ Exportar Service‑role key -------------------------
Write-Host "`n[🗝️] Exportando Service‑role key (solo para esta sesión) ..."
$env:SUPABASE_SERVICE_ROLE_KEY = $ServiceRole
Write-Host "[✅] Variable de entorno establecida."

# ------------------- 4️⃣ Desplegar la Edge Function -----------------------
Write-Host "`n[🚀] Desplegando la Edge Function (puede tardar ~30 s) ..."
supabase functions deploy api --no-verify-jwt
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[❌] ERROR al desplegar la Function. Revisa la salida anterior."
    exit 1
}
Write-Host "[✅] Function `api` desplegada."

# ------------------- 5️⃣ Construir la URL de la API -----------------------
$ApiUrl = "https://$ProjectId.supabase.co/functions/v1/api"
Write-Host "`n[🔗] URL de la API generada: $ApiUrl"

# ------------------- 6️⃣ Actualizar index.html ----------------------------
$IndexPath = Join-Path -Path $PSScriptRoot -ChildPath "index.html"
if (-Not (Test-Path $IndexPath)) {
    Write-Host "`n[❌] No se encontró index.html en $IndexPath"
    exit 1
}
# Busca la línea que contiene el placeholder y la reemplaza
$content = Get-Content $IndexPath -Raw
$pattern = "https://TU-PROYECTO\.supabase\.co/functions/v1/api"
if ($content -match $pattern) {
    $newContent = $content -replace $pattern, $ApiUrl
    Set-Content -Path $IndexPath -Value $newContent -Encoding UTF8
    Write-Host "[✅] index.html actualizado con la URL de la API."
} else {
    Write-Host "`n[⚠️] No se encontró el placeholder en index.html. Verifica que la línea sea:`"
    Write-Host "   const API = 'https://TU-PROYECTO.supabase.co/functions/v1/api';"
    Write-Host "Si ya la habías editado manualmente, está bien."

# -------------------------------------------------------------------------

# ------------------- 7️⃣ Mensaje final -----------------------------------
Write-Host "`n=== 🎉  ¡Todo listo! 🎉 ==="
Write-Host "🔹 La API está disponible en: $ApiUrl"
Write-Host "🔹 index.html ya apunta a esa URL."
Write-Host ""
Write-Host "🚀  Próximo paso: publicar la página web."
Write-Host ""
Write-Host "   • **Netlify** (más rápido):"
Write-Host "     1. Entra a https://netlify.com y crea una cuenta (gratuita)."
Write-Host "     2. En el Dashboard, arrastra *solo* el archivo index.html al recuadro"
Write-Host "        \"Drag and drop your site folder here\"."
Write-Host "     3. Netlify te dará una URL como https://nombre‑aleatorio.netlify.app"
Write-Host ""




"
# End of script
