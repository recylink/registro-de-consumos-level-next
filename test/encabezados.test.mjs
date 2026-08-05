// Verificación de la detección de encabezados alterados.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { url } from "./raiz.mjs";

mock.module(url("node_modules/server-only/index.js"), { namedExports: {}, defaultExport: {} });

const { revisarEncabezado, exigirEncabezado, EncabezadoInesperadoError } = await import(
  url("lib/sheets/encabezados.js")
);

const AGUA = [
  "Link PDF", "Número de cliente", "Fecha emisión", "Consumo total", "Costo ($)",
  "Empresa", "Sucursal", "Tipo de consumo", "Proveedor", "Subcategoría",
  "Estado", "Origen", "ID",
];

test("encabezado idéntico: nada que reportar", () => {
  const { movidas, faltantes } = revisarEncabezado(AGUA, AGUA);
  assert.deepEqual(movidas, []);
  assert.deepEqual(faltantes, []);
});

test("EL CASO: una columna movida se detecta y corta la lectura", () => {
  // Alguien arrastró "Costo ($)" delante de "Consumo total". Sin esto, la app leería
  // el costo como consumo y el consumo como costo, sin ningún error.
  const movido = [...AGUA];
  [movido[3], movido[4]] = [movido[4], movido[3]];

  const { movidas } = revisarEncabezado(movido, AGUA);
  assert.equal(movidas.length, 2);

  assert.throws(
    () => exigirEncabezado("Agua", movido, AGUA),
    (err) => {
      assert.ok(err instanceof EncabezadoInesperadoError);
      assert.match(err.message, /Costo/);
      assert.match(err.message, /columna 4/);
      return true;
    },
  );
});

test("una columna borrada también se detecta: corre a todas las de su derecha", () => {
  const sinEmpresa = AGUA.filter((h) => h !== "Empresa");
  const { movidas } = revisarEncabezado(sinEmpresa, AGUA);
  assert.ok(movidas.length >= 1);
  assert.throws(() => exigirEncabezado("Agua", sinEmpresa, AGUA), EncabezadoInesperadoError);
});

test('"Subcategoria" sin tilde es la misma columna, no un problema', () => {
  // Es el caso real documentado: un editor humano escribió el encabezado sin tilde.
  const sinTilde = AGUA.map((h) => (h === "Subcategoría" ? "Subcategoria" : h));
  const { movidas, faltantes } = revisarEncabezado(sinTilde, AGUA);
  assert.deepEqual(movidas, []);
  assert.deepEqual(faltantes, []);
  assert.doesNotThrow(() => exigirEncabezado("Agua", sinTilde, AGUA));
});

test("mayúsculas y espacios de sobra tampoco cuentan", () => {
  const ruidoso = AGUA.map((h) => `  ${h.toUpperCase()} `);
  assert.deepEqual(revisarEncabezado(ruidoso, AGUA).movidas, []);
});

test("columnas agregadas a la derecha se ignoran", () => {
  const conExtras = [...AGUA, "Notas del contador", "Revisado por"];
  const { movidas, faltantes } = revisarEncabezado(conExtras, AGUA);
  assert.deepEqual(movidas, []);
  assert.deepEqual(faltantes, []);
  assert.doesNotThrow(() => exigirEncabezado("Agua", conExtras, AGUA));
});

test("renombrar avisa pero no corta: los datos se siguen leyendo bien", () => {
  const renombrado = AGUA.map((h) => (h === "Proveedor" ? "Empresa proveedora" : h));
  const { movidas, faltantes } = revisarEncabezado(renombrado, AGUA);
  assert.deepEqual(movidas, [], "nada se movió de posición");
  assert.deepEqual(faltantes, ["Proveedor"]);
  assert.doesNotThrow(() => exigirEncabezado("Agua", renombrado, AGUA));
});

test('"ID" ausente es el estado normal antes de la migración', () => {
  const sinId = AGUA.filter((h) => h !== "ID");
  // Sin declararla opcional, saldría como faltante en cada lectura.
  assert.deepEqual(revisarEncabezado(sinId, AGUA).faltantes, ["ID"]);
  assert.doesNotThrow(() => exigirEncabezado("Agua", sinId, AGUA, { opcionales: ["ID"] }));
  assert.deepEqual(revisarEncabezado(sinId, AGUA).movidas, [], "quitar la última no corre nada");
});

test("hoja sin encabezado no se considera alterada", () => {
  assert.doesNotThrow(() => exigirEncabezado("Agua", [], AGUA));
  assert.doesNotThrow(() => exigirEncabezado("Agua", undefined, AGUA));
});
