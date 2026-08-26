// Totales del pie de la matriz: consumo y dinero, medidores contra boleta.
//
// El caso que motiva estas pruebas es el de combustible con unidades mezcladas:
// el diésel viene en litros y el GLP en kilos, y sumarlos daría un total falso
// que igual se vería como un número creíble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { boletaConsumoFor, monthTotals } from "../lib/domain/medidores-calc.js";

const SUC = "Planta Norte";

// Dos medidores de combustible con lectura en marzo y abril.
const meters = [
  { id: "m1", sucursal: SUC, type: "combustible", activo: true },
  { id: "m2", sucursal: SUC, type: "combustible", activo: true },
  // No facturable: no debe sumar ni en consumo ni en dinero.
  { id: "m3", sucursal: SUC, type: "combustible", activo: true, facturable: false },
];

const readings = [
  { meterId: "m1", month: "2026-03", lectura: 1000 },
  { meterId: "m1", month: "2026-04", lectura: 1300 }, // consumo 300
  { meterId: "m2", month: "2026-03", lectura: 500 },
  { meterId: "m2", month: "2026-04", lectura: 700 }, // consumo 200
  { meterId: "m3", month: "2026-03", lectura: 10 },
  { meterId: "m3", month: "2026-04", lectura: 99 }, // consumo 89, no cuenta
];

const prices = [{ sucursal: SUC, type: "combustible", month: "2026-04", precio: 1000 }];

const boleta = (extra) => ({
  sucursal: SUC,
  type: "combustible",
  date: "2026-04-15",
  estado: "activa",
  ...extra,
});

test("el consumo de los medidores suma solo los facturables", () => {
  const t = monthTotals(meters, readings, prices, [], SUC, "combustible", "2026-04");
  assert.equal(t.consumoMedidores, 500, "300 + 200, sin los 89 del no facturable");
  assert.equal(t.unidad, "L");
  // Mismo conjunto que el dinero: 500 L × $1.000.
  assert.equal(t.totalMedidores, 500000);
});

test("sin boleta no hay consumo de boleta ni diferencia", () => {
  const t = monthTotals(meters, readings, prices, [], SUC, "combustible", "2026-04");
  assert.equal(t.consumoBoleta, null);
  assert.equal(t.difConsumo, null);
  assert.deepEqual(t.unidadesFuera, []);
});

test("la diferencia de consumo es medidores menos boleta", () => {
  const records = [boleta({ cantidad: 480, costo: 480000, unit: "L" })];
  const t = monthTotals(meters, readings, prices, records, SUC, "combustible", "2026-04");
  assert.equal(t.consumoBoleta, 480);
  assert.equal(t.difConsumo, 20, "500 medidos contra 480 facturados");
  assert.equal(t.diferencia, 20000);
});

test("EL CASO: litros y kilos no se suman entre sí", () => {
  const records = [
    boleta({ cantidad: 480, costo: 480000, unit: "L" }),
    boleta({ cantidad: 40, costo: 60000, unit: "kg" }), // GLP
  ];
  const t = monthTotals(meters, readings, prices, records, SUC, "combustible", "2026-04");
  assert.equal(t.consumoBoleta, 480, "los 40 kg NO entran al total en litros");
  assert.deepEqual(t.unidadesFuera, ["kg"], "y se avisa que quedaron fuera");
  // El dinero sí se suma completo: los pesos son pesos venga de donde venga.
  assert.equal(t.totalBoleta, 540000);
});

test("si toda la boleta está en otra unidad, no hay total ni diferencia", () => {
  const records = [boleta({ cantidad: 40, costo: 60000, unit: "kg" })];
  const t = monthTotals(meters, readings, prices, records, SUC, "combustible", "2026-04");
  assert.equal(t.consumoBoleta, null, "no se inventa un 0 que parecería un dato");
  assert.equal(t.difConsumo, null);
  assert.deepEqual(t.unidadesFuera, ["kg"]);
});

test("una boleta eliminada no cuenta", () => {
  const records = [
    boleta({ cantidad: 480, costo: 480000, unit: "L" }),
    boleta({ cantidad: 999, costo: 999000, unit: "L", estado: "eliminada" }),
  ];
  const { total, fuera } = boletaConsumoFor(records, SUC, "combustible", "2026-04", "L");
  assert.equal(total, 480);
  assert.deepEqual(fuera, []);
});

test("electricidad y agua tienen una sola unidad, así que nunca queda nada fuera", () => {
  for (const [type, unidad] of [["electricidad", "kWh"], ["agua", "m³"]]) {
    const records = [
      { sucursal: SUC, type, date: "2026-04-15", estado: "activa", cantidad: 120, costo: 9000, unit: unidad },
    ];
    const { total, fuera } = boletaConsumoFor(records, SUC, type, "2026-04", unidad);
    assert.equal(total, 120);
    assert.deepEqual(fuera, [], `${type} no debería excluir nada`);
  }
});
