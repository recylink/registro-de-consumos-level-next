// Verificación de la escritura por clave del módulo Medidores.
// node --experimental-test-module-mocks --experimental-default-type=module verificar-medidores.mjs

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { url } from "./raiz.mjs";

// ---------------------------------------------------------------- fake sheet
const hojasMem = new Map();
const clon = (v) => JSON.parse(JSON.stringify(v));

function normalizarAncho(filas, ancho) {
  return (filas || []).map((f) => {
    if (f.length > ancho) throw new Error("fila más ancha que el encabezado");
    return [...f, ...Array(ancho - f.length).fill("")];
  });
}

// El specifier desnudo se resolvería relativo a este archivo, que vive fuera del
// repo: se apunta al archivo real. `server-only/index.js` lanza al importarse.
mock.module(url("node_modules/server-only/index.js"), {
  namedExports: {},
  defaultExport: {},
});

mock.module(url("lib/google/sheets-api.js"), {
  namedExports: {
    normalizarAncho,
    existeHoja: async (n) => hojasMem.has(n),
    crearHoja: async (n, enc) => hojasMem.set(n, [enc ? [...enc] : []]),
    leerHoja: async (n) => clon(hojasMem.get(n) || []),
    leerFilas: async (n) => clon((hojasMem.get(n) || []).slice(1)),
    leerVariasHojas: async () => ({}),
    escribirCeldas: async () => 0,
    reemplazarHoja: async () => {
      throw new Error("reemplazarHoja no debe usarse en el camino de Medidores");
    },
    escribirFilas: async (n, filas) => {
      const h = hojasMem.get(n);
      for (const f of filas) {
        const fila = h[f.row - 1];
        f.values.forEach((v, i) => (fila[i] = v));
      }
      return filas.length;
    },
    agregarFilas: async (n, filas) => {
      hojasMem.get(n).push(...clon(filas));
      return filas.length;
    },
    borrarFilas: async (n, indices) => {
      const orden = [...new Set(indices)].filter((i) => i >= 1).sort((a, b) => b - a);
      const h = hojasMem.get(n);
      for (const i of orden) h.splice(i, 1);
      return orden.length;
    },
    hojas: async () => [],
  },
});

const { SDK_POST } = await import(url("lib/google/actions.js"));
const { diffMedidores, patchVacio } = await import(url("lib/domain/medidores-patch.js"));

const ENC_LEC = [
  "ID", "Medidor ID", "Período", "Lectura",
  "Factura Link", "Factura Nombre", "Factura File ID",
  "Pago Link", "Pago Nombre", "Pago File ID",
  "Respaldo Link", "Respaldo Nombre", "Respaldo File ID",
];
const filaLec = (id, meterId, mes, lectura) =>
  [id, meterId, mes, lectura, ...Array(9).fill("")];

function sembrarLecturas(filas) {
  hojasMem.set("Lecturas Medidor", [[...ENC_LEC], ...clon(filas)]);
}
const leer = (n) => hojasMem.get(n).slice(1);

// ------------------------------------------------------------------- upsert

test("actualiza la fila de su clave y no toca ninguna otra", async () => {
  sembrarLecturas([
    filaLec("lec_a", "med_1", "2026-05", 100),
    filaLec("lec_b", "med_2", "2026-05", 200),
    filaLec("lec_c", "med_1", "2026-06", 300),
  ]);
  const antes = clon(leer("Lecturas Medidor"));

  await SDK_POST.upsertLecturasMedidor({
    rows: [filaLec("lec_NUEVO", "med_2", "2026-05", 999)],
    remove: [],
  });

  const ahora = leer("Lecturas Medidor");
  assert.equal(ahora.length, 3, "no debe cambiar la cantidad de filas");
  assert.equal(ahora[1][3], 999, "la lectura de med_2/2026-05 se actualiza");
  assert.deepEqual(ahora[0], antes[0], "med_1/2026-05 queda intacta");
  assert.deepEqual(ahora[2], antes[2], "med_1/2026-06 queda intacta");
});

test("conserva el ID de la planilla en vez del que manda el cliente", async () => {
  sembrarLecturas([filaLec("lec_original", "med_1", "2026-05", 100)]);
  await SDK_POST.upsertLecturasMedidor({
    rows: [filaLec("lec_recien_acuñado", "med_1", "2026-05", 150)],
    remove: [],
  });
  const [fila] = leer("Lecturas Medidor");
  assert.equal(fila[0], "lec_original", "el ID surrogate no debe churnear");
  assert.equal(fila[3], 150);
});

test("agrega la fila cuando la clave no existe, y usa el ID nuevo", async () => {
  sembrarLecturas([filaLec("lec_a", "med_1", "2026-05", 100)]);
  await SDK_POST.upsertLecturasMedidor({
    rows: [filaLec("lec_b", "med_1", "2026-06", 400)],
    remove: [],
  });
  const filas = leer("Lecturas Medidor");
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[1].slice(0, 4), ["lec_b", "med_1", "2026-06", 400]);
});

test("borra solo la clave pedida", async () => {
  sembrarLecturas([
    filaLec("lec_a", "med_1", "2026-05", 100),
    filaLec("lec_b", "med_2", "2026-05", 200),
  ]);
  await SDK_POST.upsertLecturasMedidor({ rows: [], remove: [["med_1", "2026-05"]] });
  const filas = leer("Lecturas Medidor");
  assert.equal(filas.length, 1);
  assert.equal(filas[0][1], "med_2");
});

test("una clave repetida en la hoja se actualiza en todas sus filas", async () => {
  sembrarLecturas([
    filaLec("lec_a", "med_1", "2026-05", 100),
    filaLec("lec_b", "med_1", "2026-05", 111),
  ]);
  await SDK_POST.upsertLecturasMedidor({
    rows: [filaLec("x", "med_1", "2026-05", 777)],
    remove: [],
  });
  const filas = leer("Lecturas Medidor");
  assert.equal(filas.length, 2, "no se borran duplicados, solo convergen");
  assert.deepEqual(filas.map((f) => f[3]), [777, 777]);
  assert.deepEqual(filas.map((f) => f[0]), ["lec_a", "lec_b"], "cada una guarda su ID");
});

test("una clave que se escribe y se borra a la vez no se borra", async () => {
  sembrarLecturas([filaLec("lec_a", "med_1", "2026-05", 100)]);
  await SDK_POST.upsertLecturasMedidor({
    rows: [filaLec("x", "med_1", "2026-05", 500)],
    remove: [["med_1", "2026-05"]],
  });
  const filas = leer("Lecturas Medidor");
  assert.equal(filas.length, 1);
  assert.equal(filas[0][3], 500);
});

test("borrar varias filas no corre los índices", async () => {
  sembrarLecturas([
    filaLec("a", "med_1", "2026-01", 1),
    filaLec("b", "med_1", "2026-02", 2),
    filaLec("c", "med_1", "2026-03", 3),
    filaLec("d", "med_1", "2026-04", 4),
  ]);
  await SDK_POST.upsertLecturasMedidor({
    rows: [],
    remove: [["med_1", "2026-01"], ["med_1", "2026-03"]],
  });
  assert.deepEqual(leer("Lecturas Medidor").map((f) => f[2]), ["2026-02", "2026-04"]);
});

test("una hoja con filas humanas sin clave no se rompe", async () => {
  sembrarLecturas([
    filaLec("a", "med_1", "2026-01", 1),
    ["", "", "", "", ...Array(9).fill("")], // fila vacía dejada por un editor
  ]);
  await SDK_POST.upsertLecturasMedidor({
    rows: [filaLec("b", "med_2", "2026-01", 5)],
    remove: [],
  });
  const filas = leer("Lecturas Medidor");
  assert.equal(filas.length, 3, "la fila vacía sobrevive; la nueva se agrega al final");
  assert.equal(filas[2][1], "med_2");
});

// --------------------------------------------------------------------- diff

const M = (o) => ({ meters: [], readings: [], prices: [], docs: {}, ...o });
const medidor = (id, extra) => ({
  id, sucursal: "Planta", type: "electricidad", nombre: "M" + id,
  numero: "", activo: true, facturable: true, ...extra,
});

test("EL CASO: un cliente con snapshot viejo no borra lo que nunca vio", async () => {
  // A abrió la pantalla cuando solo existía med_1.
  const baseA = M({ meters: [medidor("med_1")] });
  // B, en otro dispositivo, creó med_2 y escribió una lectura. A no se enteró.
  // A solo agrega su propia lectura sobre med_1.
  const actualA = M({
    meters: [medidor("med_1")],
    readings: [{ id: "x", meterId: "med_1", month: "2026-05", lectura: 10 }],
  });

  const patch = diffMedidores(baseA, actualA);

  assert.deepEqual(patch.meters, { upsert: [], remove: [] }, "A no toca ningún medidor");
  assert.deepEqual(patch.prices, { upsert: [], remove: [] });
  assert.equal(patch.readings.upsert.length, 1);
  assert.deepEqual(patch.readings.remove, [], "y sobre todo: no borra nada de B");
});

test("borrar de verdad sí produce un remove", async () => {
  const base = M({ readings: [{ id: "x", meterId: "med_1", month: "2026-05", lectura: 10 }] });
  const patch = diffMedidores(base, M({}));
  assert.deepEqual(patch.readings.remove, [{ meterId: "med_1", month: "2026-05" }]);
});

test("reescribir el mismo valor no genera patch", async () => {
  const base = M({
    meters: [medidor("med_1")],
    readings: [{ id: "x", meterId: "med_1", month: "2026-05", lectura: 10 }],
    prices: [{ sucursal: "Planta", type: "electricidad", month: "2026-05", precio: 120 }],
  });
  // Mismo contenido, ids de lectura distintos (setReading acuña uno nuevo por tecla)
  // y números como texto, tal como vuelven de la planilla.
  const igual = M({
    meters: [medidor("med_1")],
    readings: [{ id: "OTRO", meterId: "med_1", month: "2026-05", lectura: "10" }],
    prices: [{ sucursal: "Planta", type: "electricidad", month: "2026-05", precio: "120" }],
  });
  assert.ok(patchVacio(diffMedidores(base, igual)), "no debe escribir nada");
});

test("un documento limpiado borra la fila si no queda lectura", async () => {
  const base = M({ docs: { "med_1__2026-05": { factura: { link: "u", name: "f", fileId: "1" } } } });
  const despues = M({ docs: { "med_1__2026-05": { factura: null } } });
  const patch = diffMedidores(base, despues);
  assert.deepEqual(patch.readings.remove, [{ meterId: "med_1", month: "2026-05" }]);
  assert.deepEqual(patch.readings.upsert, []);
});

test("la clave de precio no confunde sucursal con tipo", async () => {
  const a = M({ prices: [{ sucursal: "Planta A", type: "", month: "2026-05", precio: 1 }] });
  const b = M({ prices: [{ sucursal: "Planta", type: "A", month: "2026-05", precio: 1 }] });
  const patch = diffMedidores(a, b);
  assert.equal(patch.prices.upsert.length, 1, "son dos precios distintos");
  assert.equal(patch.prices.remove.length, 1);
});
