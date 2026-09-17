require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const {
  fetchExogena,
  DianAuthError,
  DianOtpRequiredError,
  DianCaptchaError,
} = require("./scraper");
const { calcularTarifa } = require("./pricing");

const app = express();
app.use(express.json());

// Restringe qué dominios pueden llamar este backend (tu web, nada más).
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "https://impuestamente.com",
  })
);

// Evita fuerza bruta / spam contra el login de la DIAN.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // máx 5 intentos por IP en esa ventana
  message: { ok: false, error: "Demasiados intentos. Intenta de nuevo en 15 minutos." },
});
app.use("/api/dian-exogena", limiter);

app.post("/api/dian-exogena", async (req, res) => {
  const { cedula, clave, otp } = req.body || {};

  if (!cedula || !clave) {
    return res.status(400).json({ ok: false, error: "Cédula y clave son obligatorias." });
  }

  try {
    const result = await fetchExogena({ cedula, clave, otp });
    // Nunca se guarda cedula/clave en logs, base de datos ni archivos.
    const { price, reglasAplicadas } = calcularTarifa(result.data);
    return res.json({ ...result, price, reglasAplicadas });
  } catch (err) {
    if (err instanceof DianOtpRequiredError) {
      return res.status(401).json({ ok: false, requiresOtp: true, error: err.message });
    }
    if (err instanceof DianAuthError) {
      return res.status(401).json({ ok: false, error: err.message });
    }
    if (err instanceof DianCaptchaError) {
      return res.status(409).json({ ok: false, requiresManual: true, error: err.message });
    }
    console.error("Error inesperado en scraping DIAN:", err.message); // sin credenciales en el log
    return res.status(500).json({ ok: false, error: "No fue posible completar la consulta con la DIAN." });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DIAN RPA backend escuchando en puerto ${PORT}`));
