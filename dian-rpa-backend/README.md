# DIAN Exógena RPA — Backend

Backend que automatiza el login a MUISCA con las credenciales que el
contribuyente escribe en tu web, extrae su Información Exógena y la
devuelve ya convertida en los campos de tu calculadora (income, assets,
cardSpending, deposits, purchases).

## 1. Instalar

```bash
npm install
npx playwright install chromium
cp .env.example .env   # y ajusta ALLOWED_ORIGIN a tu dominio real
npm start
```

## 2. Cómo obtener los selectores reales (10 min, una sola vez)

`scraper.js` trae selectores de ejemplo marcados con `// AJUSTAR`.
Para reemplazarlos por los reales:

1. Abre `https://muisca.dian.gov.co` en Chrome, clic derecho → **Inspeccionar**.
2. Ve a la pestaña **Elements** y usa el ícono de flecha (Ctrl+Shift+C) para
   hacer clic sobre: el campo de cédula, el campo de clave, el botón de
   ingresar, el campo de OTP (si te aparece), el link/botón de
   "Información Exógena" y el botón de descarga del reporte.
3. Por cada uno, copia su atributo `id` o `name` (ejemplo:
   `<input id="nit" name="nit">` → usarías `input[name="nit"]`).
4. Pega cada selector real en el lugar del placeholder correspondiente
   en `scraper.js`.

Si la DIAN no usa `id`/`name` estables, usa el texto visible del botón
con `page.click('text=Continuar')`, que es más resistente a cambios de
diseño.

## 3. Dónde correr esto (importante)

Este backend **no funciona en Vercel serverless** (Playwright necesita
más tiempo y recursos de los que permite una función serverless
estándar). Opciones recomendadas:

- **Railway** o **Render** (más simple, soportan contenedores con Playwright).
- Una VM pequeña (DigitalOcean/AWS Lightsail) con Docker.

## 4. Conectar con tu frontend actual

En vez de (o junto a) el input de archivo, agrega un formulario con
cédula/clave y llama:

```js
const res = await fetch("https://tu-backend.com/api/dian-exogena", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cedula, clave, otp }),
});
const { ok, data, requiresOtp, requiresManual, error } = await res.json();

if (requiresOtp) {
  // Muestra un campo para que el usuario ingrese el OTP y reenvía la solicitud.
} else if (requiresManual) {
  // La DIAN pidió captcha: cae al flujo manual (subir Excel) como respaldo.
} else if (ok) {
  // Rellena income/assets/cardSpending/deposits/purchases con `data`
  // y sigue el mismo flujo de cálculo que ya tienes.
}
```

**Siempre deja el flujo de subir el Excel manual como respaldo** (botón
"o sube tu archivo manualmente"): si la DIAN activa captcha o cambia el
portal, tu calculadora no debe quedar bloqueada.

## 5. Requisito legal antes de pedir la clave

Antes del formulario de cédula/clave, muestra un checkbox obligatorio:

> "Autorizo a Impuestamente a usar mis credenciales de la DIAN
> únicamente para consultar mi Información Exógena en este momento.
> Confirmo que mi clave no será almacenada." — según Ley 1581 de 2012
> (habeas data).

## 6. Pendientes antes de producción

- [ ] Ajustar los selectores reales (paso 2).
- [ ] Probar el flujo de OTP con una cuenta DIAN real.
- [ ] Definir plan B si aparece captcha (2Captcha/Anti-Captcha o caída a manual).
- [ ] Confirmar en `.env` el dominio real en `ALLOWED_ORIGIN`.
- [ ] Revisar con un abogado el texto de autorización del punto 5.
