// Verificación de updateCeldasPorClave: el UPDATE ... WHERE de las hojas de consumo.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { url } from "./raiz.mjs";

const hojasMem = new Map();
const clon = (v) => JSON.parse(JSON.stringify(v));

mock.module(url("node_modules/server-only/index.js"), { namedExports: {}, defaultExport: {} });

mock.module(url("lib/google/sheets-api.js"), {
  namedExports: {
    normalizarAncho: (f) => f,
    existeHoja: async (n) => hojasMem.has(n),
    crearHoja: async (n, enc) => hojasMem.set(n, [enc ? [...enc] : []]),
    leerHoja: async (n) => clon(hojasMem.get(n) || []),
    leerFilas: async (n) => clon((hojasMem.get(n) || []).slice(1)),
    leerVariasHojas: async () => ({}),
    reemplazarHoja: async () => {
      throw new Error("reemplazarHoja no debe usarse acá");
    },
    escribirCeldas: async (n, celdas) => {
      const h = hojasMem.get(n);
      for (const c of celdas) h[c.row - 1][c.col - 1] = c.value;
      return celdas.length;
    },
    escribirFilas: async () => 0,
    agregarFilas: async () => 0,
    borrarFilas: async () => 0,
    hojas: async () => [],
  },
});

const { SDK_POST } = await import(url("lib/google/actions.js"));

// Combustible: [Link, Fecha, Consumo, Costo, Empresa, Sucursal, Tipo, Proveedor,
//               Estado, Origen, ID] — la columna ID es la 11.
const COL_ID = 11;
const COL_CONSUMO = 3;
const HOJA = "Combustible";
const ENC = ["Link", "Fecha", "Consumo", "Costo", "Empresa", "Sucursal", "Tipo",
  "Proveedor", "Estado", "Origen", "ID"];

const filaComb = (fecha, consumo, suc, id) =>
  ["", fecha, consumo, "", "NEXT", suc, "Petróleo Diesel", "Copec", "Cargado", "Manual", id];

const sembrar = (filas) => hojasMem.set(HOJA, [[...ENC], ...clon(filas)]);
const leer = () => hojasMem.get(HOJA).slice(1);

const editar = (id, col, value) =>
  SDK_POST.updateCeldasPorClave({
    sheet: HOJA,
    cols: [COL_ID],
    clave: [id],
    celdas: [{ col, value }],
  });

test("escribe en la fila del ID, no en la posición", async () => {
  sembrar([
    filaComb("31-05-26", 100, "Planta A", "comb_aaa"),
    filaComb("30-06-26", 200, "Planta A", "comb_bbb"),
    filaComb("31-07-26", 300, "Planta B", "comb_ccc"),
  ]);

  const res = await editar("comb_bbb", COL_CONSUMO, 999);

  assert.equal(res.filas, 1);
  assert.deepEqual(leer().map((f) => f[COL_CONSUMO - 1]), [100, 999, 300]);
});

test("EL CASO: reordenar la planilla ya no manda la edición a otra fila", async () => {
  // Un humano ordenó Combustible por sucursal. comb_ccc pasó de la fila 4 a la 2.
  sembrar([
    filaComb("31-07-26", 300, "Planta B", "comb_ccc"),
    filaComb("31-05-26", 100, "Planta A", "comb_aaa"),
    filaComb("30-06-26", 200, "Planta A", "comb_bbb"),
  ]);

  // La app tenía en memoria que comb_ccc era el índice 2 (fila 4). Con el id real
  // eso deja de importar.
  await editar("comb_ccc", COL_CONSUMO, 777);

  const filas = leer();
  assert.equal(filas[0][COL_CONSUMO - 1], 777, "se editó comb_ccc, esté donde esté");
  assert.equal(filas[2][COL_CONSUMO - 1], 200, "comb_bbb, que ocupa la vieja fila 4, intacto");
});

test("un id que no está devuelve 0 filas en vez de escribir a ciegas", async () => {
  sembrar([filaComb("31-05-26", 100, "Planta A", "comb_aaa")]);
  const res = await editar("comb_nope", COL_CONSUMO, 5);
  assert.equal(res.filas, 0);
  assert.equal(leer()[0][COL_CONSUMO - 1], 100, "nada se tocó");
});

test("filas sin id no capturan la edición de otro", async () => {
  // Estado intermedio de la migración: hay filas viejas sin id y filas nuevas con id.
  sembrar([
    filaComb("31-05-26", 100, "Planta A", ""),
    filaComb("30-06-26", 200, "Planta A", ""),
    filaComb("31-07-26", 300, "Planta B", "comb_ccc"),
  ]);
  await editar("comb_ccc", COL_CONSUMO, 555);
  assert.deepEqual(leer().map((f) => f[COL_CONSUMO - 1]), [100, 200, 555]);
});

test("escribe varias celdas de la misma fila en una sola pasada", async () => {
  sembrar([filaComb("31-05-26", 100, "Planta A", "comb_aaa")]);
  const res = await SDK_POST.updateCeldasPorClave({
    sheet: HOJA,
    cols: [COL_ID],
    clave: ["comb_aaa"],
    celdas: [
      { col: COL_CONSUMO, value: 42 },
      { col: 6, value: "Planta Z" },
    ],
  });
  assert.equal(res.celdas, 2);
  const [fila] = leer();
  assert.equal(fila[COL_CONSUMO - 1], 42);
  assert.equal(fila[5], "Planta Z");
});
