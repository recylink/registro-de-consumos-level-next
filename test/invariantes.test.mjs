// Invariantes de la capa de escritura.
//
// Estas pruebas no ejercitan una función: protegen decisiones. Cada arreglo de
// pérdida de datos de este módulo se puede deshacer sin romper ningún test de
// comportamiento —basta volver a exponer una action vieja— y eso es exactamente lo
// que ya pasó una vez, cuando la migración al SDK portó el clear+rewrite con
// fidelidad. Acá quedan escritas las reglas.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { url } from "./raiz.mjs";

mock.module(url("node_modules/server-only/index.js"), { namedExports: {}, defaultExport: {} });

// `reemplazarHoja` lanza: si alguna action que la app puede alcanzar la llamara, se
// vería acá en vez de en la planilla.
mock.module(url("lib/google/sheets-api.js"), {
  namedExports: {
    normalizarAncho: (f) => f,
    existeHoja: async () => true,
    crearHoja: async () => {},
    leerHoja: async () => [[]],
    leerFilas: async () => [],
    leerVariasHojas: async () => ({}),
    escribirCeldas: async () => 0,
    escribirFilas: async () => 0,
    agregarFilas: async () => 0,
    borrarFilas: async () => 0,
    hojas: async () => [],
    reemplazarHoja: async () => {
      throw new Error("reemplazarHoja: reescritura de hoja completa");
    },
  },
});

const { SDK_POST, SDK_GET } = await import(url("lib/google/actions.js"));

// Las actions que reescribían una hoja completa. Ninguna debe volver al SDK: mientras
// esté implementada, un RC_SDK_ACTIONS con el nombre viejo la revive, y el .gs las
// atendió hasta v5.
const RETIRADAS = [
  "setMedidores",
  "setLecturasMedidor",
  "setPreciosMedidor",
  "setConfigSucursales",
];

for (const action of RETIRADAS) {
  test(`"${action}" no vuelve al SDK (reescribía la hoja completa)`, () => {
    assert.ok(
      !Object.hasOwn(SDK_POST, action),
      `${action} volvió a estar implementada. Reescribe la hoja entera, así que dos ` +
        `sesiones editando a la vez se borran el trabajo. Usar la upsert* equivalente.`,
    );
  });
}

test("setEmissions sigue implementada, pero solo para la verificación", () => {
  // No es una excepción olvidada: /api/migracion/probe-c la usa para comparar los dos
  // backends sobre una hoja que crea y borra. Si algún día se retira ese probe, esta
  // action se va con él.
  assert.ok(Object.hasOwn(SDK_POST, "setEmissions"));
});

test("ninguna action de escritura de la app reescribe una hoja completa", async () => {
  // Las actions que la app llama de verdad, con un payload vacío que igual llega a la
  // capa de escritura. Se excluye `setEmissions` por lo de arriba.
  const CASOS = {
    append: { sheet: "Combustible", values: [["x"]] },
    update: { sheet: "Combustible", row: 2, col: 1, value: "x" },
    updateCells: { sheet: "Combustible", cells: [{ row: 2, col: 1, value: "x" }] },
    updateCeldasPorClave: { sheet: "Combustible", cols: [11], clave: ["comb_x"], celdas: [] },
    setConfig: { key: "k", value: 1 },
    upsertMedidores: { rows: [], remove: [] },
    upsertLecturasMedidor: { rows: [], remove: [] },
    upsertPreciosMedidor: { rows: [], remove: [] },
    upsertEmisiones: { rows: [], remove: [], grupos: [] },
    upsertSucursal: { id: "suc_1", rows: [] },
    deleteSucursal: { id: "suc_1" },
    init: {},
  };

  for (const [action, body] of Object.entries(CASOS)) {
    assert.ok(Object.hasOwn(SDK_POST, action), `falta la action ${action}`);
    // Lo único que importa es que NO sea el error de reescritura. Cualquier otro fallo
    // (hoja inexistente, payload incompleto) es ruido del mock y no dice nada.
    try {
      await SDK_POST[action]({ action, ...body });
    } catch (err) {
      assert.doesNotMatch(
        err.message,
        /reescritura de hoja completa/,
        `${action} llamó a reemplazarHoja`,
      );
    }
  }
});

test("las lecturas siguen siendo las ocho conocidas", () => {
  // Si aparece una lectura nueva, tiene que decidirse explícitamente su modo (crudo o
  // display): es lo único que no se puede deducir después, y elegir mal cambia en
  // silencio lo que leen los parsers.
  assert.deepEqual(Object.keys(SDK_GET).sort(), [
    "getConfig",
    "getConfigSucursales",
    "getEmissions",
    "getFotos",
    "getLecturasMedidor",
    "getMedidores",
    "getPreciosMedidor",
    "read",
  ]);
});
