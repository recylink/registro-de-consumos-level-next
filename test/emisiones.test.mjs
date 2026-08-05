// Verificación de la escritura por clave de la hoja Emisiones.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { url } from "./raiz.mjs";

const hojasMem = new Map();
const clon = (v) => JSON.parse(JSON.stringify(v));

function normalizarAncho(filas, ancho) {
  return (filas || []).map((f) => {
    if (f.length > ancho) throw new Error("fila más ancha que el encabezado");
    return [...f, ...Array(ancho - f.length).fill("")];
  });
}

mock.module(url("node_modules/server-only/index.js"), { namedExports: {}, defaultExport: {} });

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
      throw new Error("reemplazarHoja no debe usarse en el camino de Emisiones");
    },
    escribirFilas: async (n, filas) => {
      const h = hojasMem.get(n);
      for (const f of filas) f.values.forEach((v, i) => (h[f.row - 1][i] = v));
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
const { diffEmisiones, patchEmisionesVacio } = await import(
  url("lib/domain/emisiones-patch.js")
);

const ENC = ["Scope", "Sucursal ID", "Key", "Value", "Pending Review", "Refrig Tipo", "Refrig Mes"];
const HOJA = "Emisiones";
const fila = (scope, sucId, key, value, pend = "", tipo = "", mes = "") =>
  [scope, sucId, key, value, pend, tipo, mes];

const sembrar = (filas) => hojasMem.set(HOJA, [[...ENC], ...clon(filas)]);
const leer = () => hojasMem.get(HOJA).slice(1);

// ------------------------------------------------------------------ upsert

test("actualiza un factor sin tocar los demás", async () => {
  sembrar([
    fila("factor-empresa", "", "electricidad", 0.4),
    fila("factor-empresa", "", "diesel", 2.6),
    fila("meta-empresa", "", "absoluta", 30),
  ]);
  const antes = clon(leer());

  await SDK_POST.upsertEmisiones({
    rows: [fila("factor-empresa", "", "diesel", 2.9)],
    remove: [],
    grupos: [],
  });

  const ahora = leer();
  assert.equal(ahora.length, 3);
  assert.equal(ahora[1][3], 2.9);
  assert.deepEqual(ahora[0], antes[0]);
  assert.deepEqual(ahora[2], antes[2], "la meta no se toca");
});

test("el mismo key en empresa y en sucursal son filas distintas", async () => {
  sembrar([
    fila("factor-empresa", "", "electricidad", 0.4),
    fila("factor-sucursal", "suc_1", "electricidad", 0.5, "No"),
  ]);
  await SDK_POST.upsertEmisiones({
    rows: [fila("factor-sucursal", "suc_1", "electricidad", 0.7, "Sí")],
    remove: [],
    grupos: [],
  });
  const ahora = leer();
  assert.equal(ahora[0][3], 0.4, "el de empresa queda igual");
  assert.deepEqual(ahora[1].slice(3, 5), [0.7, "Sí"]);
});

test("borra la meta de una sucursal y deja las otras", async () => {
  sembrar([
    fila("meta-sucursal", "suc_1", "absoluta", 20),
    fila("meta-sucursal", "suc_2", "absoluta", 25),
  ]);
  await SDK_POST.upsertEmisiones({
    rows: [],
    remove: [["meta-sucursal", "suc_1", "absoluta"]],
    grupos: [],
  });
  const ahora = leer();
  assert.equal(ahora.length, 1);
  assert.equal(ahora[0][1], "suc_2");
});

// ------------------------------------------------------------------ grupos

test("reemplazar el grupo de una sucursal no toca la otra ni los factores", async () => {
  sembrar([
    fila("factor-empresa", "", "electricidad", 0.4),
    fila("refrigerante", "suc_1", "rf_a", 3, "", "r410a", "2026-05"),
    fila("refrigerante", "suc_1", "rf_b", 1, "", "r134a", "2026-05"),
    fila("refrigerante", "suc_2", "rf_c", 7, "", "r32", "2026-05"),
  ]);

  await SDK_POST.upsertEmisiones({
    rows: [],
    remove: [],
    grupos: [
      {
        clave: ["refrigerante", "suc_1"],
        rows: [fila("refrigerante", "suc_1", "rf_a", 9, "", "r410a", "2026-06")],
      },
    ],
  });

  const ahora = leer();
  assert.deepEqual(
    ahora.map((f) => [f[0], f[1], f[2]]),
    [
      ["factor-empresa", "", "electricidad"],
      ["refrigerante", "suc_2", "rf_c"],
      ["refrigerante", "suc_1", "rf_a"],
    ],
    "las nuevas quedan al final; suc_2 y el factor intactos",
  );
  assert.equal(ahora[2][3], 9);
  assert.equal(ahora[2][6], "2026-06");
});

test("un grupo vacío borra los refrigerantes de esa sucursal", async () => {
  sembrar([
    fila("refrigerante", "suc_1", "rf_a", 3, "", "r410a", "2026-05"),
    fila("refrigerante", "suc_2", "rf_c", 7, "", "r32", "2026-05"),
  ]);
  await SDK_POST.upsertEmisiones({
    rows: [],
    remove: [],
    grupos: [{ clave: ["refrigerante", "suc_1"], rows: [] }],
  });
  const ahora = leer();
  assert.equal(ahora.length, 1);
  assert.equal(ahora[0][1], "suc_2");
});

test("dos refrigerantes sin uid en la misma sucursal no se colapsan", async () => {
  // Es el caso que motivó tratarlos por grupo en vez de por clave (uid vacío).
  sembrar([
    fila("refrigerante", "suc_1", "", 3, "", "r410a", "2026-05"),
    fila("refrigerante", "suc_1", "", 5, "", "r134a", "2026-05"),
  ]);
  await SDK_POST.upsertEmisiones({
    rows: [],
    remove: [],
    grupos: [
      {
        clave: ["refrigerante", "suc_1"],
        rows: [
          fila("refrigerante", "suc_1", "", 3, "", "r410a", "2026-05"),
          fila("refrigerante", "suc_1", "", 5, "", "r134a", "2026-05"),
          fila("refrigerante", "suc_1", "rf_n", 8, "", "r32", "2026-06"),
        ],
      },
    ],
  });
  const ahora = leer();
  assert.equal(ahora.length, 3, "las dos sin uid sobreviven, más la nueva");
  assert.deepEqual(ahora.map((f) => f[3]), [3, 5, 8]);
});

// -------------------------------------------------------------------- diff

const E = (o) => ({
  factoresEmpresa: {},
  factoresSucursal: {},
  refrigerantesSucursal: {},
  metas: { empresa: {}, sucursales: {} },
  ...o,
});

test("EL CASO: editar un factor no borra la meta que otro guardó", async () => {
  const base = E({ factoresEmpresa: { electricidad: { value: 0.4 } } });
  const despues = E({ factoresEmpresa: { electricidad: { value: 0.9 } } });
  const patch = diffEmisiones(base, despues);
  assert.equal(patch.filas.upsert.length, 1);
  assert.deepEqual(patch.filas.remove, [], "no borra nada que no conociera");
  assert.deepEqual(patch.grupos, []);
});

test("2.5 contra \"2.5\" no genera escritura", async () => {
  const base = E({
    factoresEmpresa: { electricidad: { value: 2.5 } },
    metas: { empresa: { absoluta: 30, baseMode: "auto" }, sucursales: {} },
  });
  const igual = E({
    factoresEmpresa: { electricidad: { value: "2.5" } },
    metas: { empresa: { absoluta: "30", baseMode: "auto" }, sucursales: {} },
  });
  assert.ok(patchEmisionesVacio(diffEmisiones(base, igual)));
});

test("quitar una meta de sucursal produce sus removes", async () => {
  const base = E({ metas: { empresa: {}, sucursales: { suc_1: { absoluta: 20, anioBase: 2021 } } } });
  const patch = diffEmisiones(base, E({}));
  assert.deepEqual(
    patch.filas.remove.map((r) => r.key).sort(),
    ["absoluta", "anioBase"],
  );
});

test("solo la sucursal cuyos refrigerantes cambiaron entra como grupo", async () => {
  const base = E({
    refrigerantesSucursal: {
      suc_1: [{ uid: "rf_a", tipo: "r410a", cargaKg: 3, mes: "2026-05" }],
      suc_2: [{ uid: "rf_c", tipo: "r32", cargaKg: 7, mes: "2026-05" }],
    },
  });
  const despues = E({
    refrigerantesSucursal: {
      suc_1: [{ uid: "rf_a", tipo: "r410a", cargaKg: 4, mes: "2026-05" }],
      suc_2: [{ uid: "rf_c", tipo: "r32", cargaKg: 7, mes: "2026-05" }],
    },
  });
  const patch = diffEmisiones(base, despues);
  assert.equal(patch.grupos.length, 1);
  assert.equal(patch.grupos[0].sucId, "suc_1");
  assert.deepEqual(patch.filas.upsert, [], "los refrigerantes no viajan como filas");
});

test("pendingReview cambia el factor aunque el valor sea el mismo", async () => {
  const base = E({ factoresSucursal: { suc_1: { diesel: { value: 2.6, pendingReview: false } } } });
  const despues = E({ factoresSucursal: { suc_1: { diesel: { value: 2.6, pendingReview: true } } } });
  const patch = diffEmisiones(base, despues);
  assert.equal(patch.filas.upsert.length, 1);
  assert.equal(patch.filas.upsert[0].pendingReview, true);
});
