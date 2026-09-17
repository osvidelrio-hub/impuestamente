/**
 * scraper.js
 * ---------------------------------------------------------------
 * Automatiza: login en MUISCA -> navegar a "Información Exógena"
 * -> extraer/descargar el reporte -> devolver datos ya parseados.
 *
 * IMPORTANTE - Selectores pendientes de ajustar:
 * No tengo acceso al portal real de la DIAN para inspeccionar el
 * DOM exacto (login, captcha, menú, botón de descarga). Dejé cada
 * selector marcado con "// AJUSTAR:" y una guía de cómo obtenerlo
 * tú mismo en 10 minutos (ver README.md, sección "Cómo obtener
 * los selectores reales").
 *
 * Principios de seguridad que ya están implementados:
 * - La clave nunca se escribe a disco ni se loguea (console.log).
 * - El navegador corre en modo efímero: se cierra y se destruye
 *   la sesión al terminar (éxito o error).
 * - Si algo fallara y quisieras depurar con capturas de pantalla,
 *   está deshabilitado por defecto (DEBUG_SCREENSHOTS=false) para
 *   no dejar rastro de datos sensibles en disco por accidente.
 */

const { chromium } = require("playwright");

const MUISCA_LOGIN_URL =
  "https://muisca.dian.gov.co/WebIdentidadLogin/?ideRequest=eyJjbGllbnRJZCI6IldvMGFLQWxCN3ZSUF8xNmZyUEkxeDlacGhCRWEiLCJyZWRpcmVjdF91cmkiOiJodHRwOi8vbXVpc2NhLmRpYW4uZ292LmNvL0lkZW50aWRhZFJlc3RfTG9naW5GaWx0cm8vYXBpL3N0cy92MS9hdXRoL2NhbGxiYWNrP3JlZGlyZWN0X3VyaT1odHRwJTNBJTJGJTJGbXVpc2NhLmRpYW4uZ292LmNvJTJGV2ViQXJxdWl0ZWN0dXJhJTJGRGVmTG9naW4uZmFjZXMiLCJyZXNwb25zZVR5cGUiOiIiLCJzY29wZSI6IiIsInN0YXRlIjoiIiwibm9uY2UiOiIiLCJwYXJhbXMiOnsidGlwb1VzdWFyaW8iOiJtdWlzY2EifX0%3D";

const DEBUG_SCREENSHOTS = process.env.DEBUG_SCREENSHOTS === "true";

class DianAuthError extends Error {}
class DianOtpRequiredError extends Error {}
class DianCaptchaError extends Error {}
class DianScrapeError extends Error {}

/**
 * Lanza el flujo completo. Se llama desde server.js.
 * @param {Object} creds
 * @param {string} creds.cedula
 * @param {string} creds.clave
 * @param {string} [creds.otp] - código OTP, si la DIAN lo pide en un 2do paso
 */
async function fetchExogena({ cedula, clave, otp }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Contexto aislado por request: nada de cookies/caché compartido entre usuarios.
  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(MUISCA_LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });

    // --- PASO 1: Login -------------------------------------------------
    // AJUSTAR: reemplazar estos selectores por los reales del formulario.
    // Sugerencia: usa atributos estables (id, name) en vez de clases CSS
    // que la DIAN cambia seguido.
    // Selecciona "Cédula de ciudadanía" para habilitar el campo de documento
        // Selecciona "Cédula de ciudadanía" para habilitar el campo de documento
    await page.click('mat-select');
    await page.click('mat-option:has-text("Cédula de ciudadanía")');
    await page.waitForTimeout(500);

    // Angular no valida bien un .fill() directo: simulamos tecleo real.
    await page.click('input[name="numDocumento"]');
    await page.locator('input[name="numDocumento"]').pressSequentially(cedula, { delay: 50 });

    await page.click('input[name="password"]');
    await page.locator('input[name="password"]').pressSequentially(clave, { delay: 50 });

            // Saca el foco del último campo para que Angular termine de validar.
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);

    // Marca el checkbox de autorización de tratamiento de datos (obligatorio).
    await page.click('mat-checkbox[name="aceptaTratamientoDatos"]');
    await page.waitForTimeout(300);

    await maybeSolveCaptcha(page); // ver función abajo

    // --- DIAGNÓSTICO: si el botón sigue deshabilitado, revisamos qué
    // campo obligatorio falta ANTES de perder 30s reintentando a ciegas.
    const ingresarBtn = page.locator('button:has-text("Ingresar")');
    const isDisabled = await ingresarBtn.getAttribute("disabled");
    if (isDisabled !== null) {
      const requiredEls = await page.locator("[required]").all();
      const diagnostico = [];
      for (const el of requiredEls) {
        const tag = await el.evaluate((n) => n.tagName);
        const name = (await el.getAttribute("name")) || (await el.getAttribute("id")) || "(sin name)";
        const value = await el.inputValue().catch(() => "(no aplica)");
        diagnostico.push(`${tag} name="${name}" -> valor tiene ${value.length} caracteres`);
      }
      console.error("DIAGNÓSTICO botón Ingresar deshabilitado. Campos requeridos encontrados:");
      console.error(diagnostico.join("\n"));
      throw new DianAuthError(
        "El botón de Ingresar sigue deshabilitado. Revisa los logs de Railway para ver el diagnóstico de campos."
      );
    }

    await page.click('button:has-text("Ingresar")');
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    // --- PASO 2: OTP / segundo factor (si aplica) -----------------------
    const otpFieldVisible = await page
      .locator('input[name="otp"]') // AJUSTAR
      .isVisible()
      .catch(() => false);

    if (otpFieldVisible) {
      if (!otp) {
        // El backend le pide al frontend un segundo request con el OTP.
        throw new DianOtpRequiredError(
          "La DIAN solicitó un código de verificación (OTP). Reenvía la solicitud incluyéndolo."
        );
      }
      await page.fill('input[name="otp"]', otp); // AJUSTAR
      await page.click('button[type="submit"]'); // AJUSTAR
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    }

    // --- Validar que el login fue exitoso -------------------------------
    const loginFailed = await page
      .locator("text=Usuario o contraseña incorrectos") // AJUSTAR al mensaje real
      .isVisible()
      .catch(() => false);

    if (loginFailed) {
      throw new DianAuthError("Cédula o clave incorrectas.");
    }

    // --- PASO 3: Navegar a "Información Exógena" ------------------------
    // AJUSTAR: la ruta real puede ser un link de texto, un ítem de menú,
    // o requerir 2-3 clics (Servicios > Consultas > Exógena, por ejemplo).
            await page.click('input[name="vistaDashboard:frmDashboard:btnExogena"]');

    // Este portal usa AJAX viejo (RichFaces), no navegación completa:
    // esperamos el elemento específico en vez de "networkidle".
    try {
      await page.waitForSelector('text=Aceptar', { state: "visible", timeout: 10000 });
      await page.click('text=Aceptar');
    } catch {
      // No apareció el modal esta vez; seguimos sin problema.
    }

    await page.waitForSelector('select[name="vistaDashboard:frmDashboard:anioSel"]', {
      state: "visible",
      timeout: 20000,
    });
    await page.selectOption('select[name="vistaDashboard:frmDashboard:anioSel"]', "2025");
    await page.waitForTimeout(500);

    // --- PASO 4: Generar y descargar el reporte --------------------------
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45000 }),
      page.click('input[name="vistaDashboard:frmDashboard:btnExogenaGenerar"]'),
    ]);
    const filePath = await download.path();

    const parsed = await parseExogenaFile(filePath);

    return { ok: true, data: parsed };
  } catch (err) {
    if (DEBUG_SCREENSHOTS) {
      await page.screenshot({ path: `debug-error-${Date.now()}.png` }).catch(() => {});
    }
    throw err;
  } finally {
    // Cierre garantizado: nunca queda una sesión ni credenciales colgando.
    await context.close();
    await browser.close();
  }
}

/**
 * Placeholder para resolver captcha si la DIAN lo activa.
 * La DIAN históricamente NO pide captcha en el login estándar de
 * personas naturales, pero puede activarlo tras varios intentos
 * fallidos o en ciertas campañas antibots. Si aparece, este es el
 * punto de falla más probable de todo el flujo.
 */
async function maybeSolveCaptcha(page) {
  const hasCaptcha = await page
    .locator('img[alt="captcha"]') // AJUSTAR
    .isVisible()
    .catch(() => false);

  if (hasCaptcha) {
    throw new DianCaptchaError(
      "La DIAN presentó un captcha. Este flujo automático no puede resolverlo; " +
        "pide al usuario que inicie sesión manualmente esta vez, o intégra un " +
        "servicio de resolución de captcha (2Captcha/Anti-Captcha) como plan B."
    );
  }
}

/**
 * Convierte el archivo descargado (xlsx/csv) en los mismos campos
 * que ya usa tu calculadora del frontend (income, assets, etc.).
 * Reutiliza la misma lógica de "Tope 1..5" que ya tienes en el HTML.
 */
async function parseExogenaFile(filePath) {
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(filePath);

  const topeMap = { 1: null, 2: null, 3: null, 4: null, 5: null };
  const topeRegex = /tope\s*([1-5])\b/i;

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    rows.forEach((row) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell) => {
        if (typeof cell !== "string") return;
        const match = cell.match(topeRegex);
        if (!match) return;
        const n = Number(match[1]);
        if (topeMap[n] !== null) return;
        const value = row.find((v) => typeof v === "number" && Number.isFinite(v));
        topeMap[n] = typeof value === "number" ? value : 0;
      });
    });
  });

  return {
    income: topeMap[1] ?? 0,
    assets: topeMap[2] ?? 0,
    cardSpending: topeMap[3] ?? 0,
    deposits: topeMap[4] ?? 0,
    purchases: topeMap[5] ?? 0,
  };
}

module.exports = {
  fetchExogena,
  DianAuthError,
  DianOtpRequiredError,
  DianCaptchaError,
  DianScrapeError,
};
