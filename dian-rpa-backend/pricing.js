/**
 * pricing.js
 * ---------------------------------------------------------------
 * Calcula la tarifa de la declaración de renta con base en los
 * valores extraídos de la Información Exógena (nunca desde datos
 * digitados manualmente en el frontend, para evitar adulteración).
 *
 * Regla general: si varias condiciones aplican al mismo tiempo,
 * SIEMPRE gana el precio más alto entre las que coincidan.
 */

const UMBRAL = {
  M50: 50_000_000,
  M70: 70_000_000,
  M170: 170_000_000,
  M200: 200_000_000,
  M300: 300_000_000,
  M500: 500_000_000,
};

const REGLAS = [
  {
    id: "R1",
    label: "Ingresos < 50M y Patrimonio < 170M",
    price: 200000,
    test: ({ income, assets }) => income < UMBRAL.M50 && assets < UMBRAL.M170,
  },
  {
    id: "R1b",
    label: "Ingresos < 50M y Patrimonio 170M–300M",
    price: 300000,
    test: ({ income, assets }) =>
      income < UMBRAL.M50 && assets >= UMBRAL.M170 && assets < UMBRAL.M300,
  },
  {
    id: "R2",
    label: "Ingresos 50M–200M y Patrimonio < 170M",
    price: 300000,
    test: ({ income, assets }) =>
      income >= UMBRAL.M50 && income < UMBRAL.M200 && assets < UMBRAL.M170,
  },
  {
    id: "R3",
    label: "Ingresos 50M–200M y Patrimonio ≥ 170M",
    price: 350000,
    test: ({ income, assets }) =>
      income >= UMBRAL.M50 && income < UMBRAL.M200 && assets >= UMBRAL.M170,
  },
  {
    id: "R4",
    label: "Ingresos 200M–500M",
    price: 400000,
    test: ({ income }) => income >= UMBRAL.M200 && income < UMBRAL.M500,
  },
  {
    id: "R5",
    label: "Ingresos ≥ 500M o Patrimonio ≥ 300M",
    price: 500000,
    test: ({ income, assets }) => income >= UMBRAL.M500 || assets >= UMBRAL.M300,
  },
  {
    id: "R6",
    label: "Consignaciones ≥ 170M con Ingresos < 70M",
    price: 400000,
    test: ({ income, deposits }) => deposits >= UMBRAL.M170 && income < UMBRAL.M70,
  },
];

/**
 * @param {Object} datos - { income, assets, deposits } en pesos (no en millones)
 * @returns {{ price: number, reglasAplicadas: string[] }}
 */
function calcularTarifa(datos) {
  const income = Number(datos.income) || 0;
  const assets = Number(datos.assets) || 0;
  const deposits = Number(datos.deposits) || 0;

  const contexto = { income, assets, deposits };
  const coincidencias = REGLAS.filter((regla) => regla.test(contexto));

  if (coincidencias.length === 0) {
    // No debería pasar (las reglas cubren todo el rango de ingresos),
    // pero por seguridad no se cobra de menos: cae al tramo más alto.
    console.warn("Ninguna regla de tarifa coincidió. Revisar cobertura de reglas.", contexto);
    return { price: 500000, reglasAplicadas: ["FALLBACK"] };
  }

  const price = Math.max(...coincidencias.map((r) => r.price));
  const reglasAplicadas = coincidencias
    .filter((r) => r.price === price)
    .map((r) => r.id);

  return { price, reglasAplicadas };
}

module.exports = { calcularTarifa, REGLAS, UMBRAL };
