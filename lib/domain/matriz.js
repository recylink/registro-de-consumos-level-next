// Matriz de estado de carga: sucursal × tipo de consumo × subcategoría, para un
// mes. Portado de proto/upload-matrix.jsx.
//
// Cuatro estados por casilla:
//   cargado         hay al menos un registro
//   pendiente       falta y el mes ya cerró  → rojo
//   pendiente-soft  falta pero el mes está en curso → gris
//   na              la sucursal no tiene ese consumo configurado

import { ITEM_DEFS, sistemaLabel, tipoAguaLabel, tipoCombLabel, tipoRefriLabel, OTRO } from "./opciones";
import { aguaSubcatFromConfig, ITEM_TYPES } from "./sucursales";

export const TIPOS_MATRIZ = ITEM_TYPES.map((id) => ({ id, ...ITEM_DEFS[id] }));

/**
 * ¿El período ya cerró? El mes en curso no cuenta: recién desde el día 1 del mes
 * siguiente tiene sentido marcar algo como atrasado.
 *
 * En el prototipo esto leía `new Date()` dentro del componente. Acá se compara
 * contra el mes actual que fija el servidor, así el color de una casilla no
 * depende del reloj del navegador.
 */
export function periodoCerrado(monthKey, mesActual) {
  if (!monthKey || !mesActual) return false;
  return monthKey < mesActual;
}

/**
 * ¿Este registro corresponde a esta subcategoría configurada?
 *
 * Electricidad es el caso especial: sus registros no llevan subcategoría, así que
 * cualquier registro eléctrico de la sucursal en el mes cuenta para todas las
 * subcategorías eléctricas configuradas. No hay forma de saber a qué empalme
 * corresponde.
 */
function corresponde(rec, cfgSub, type) {
  if (type === "electricidad") return true;
  if (type === "agua") return aguaSubcatFromConfig(cfgSub)?.id === rec.subcat;
  return rec.subcat === cfgSub.tipo; // combustible y refrigerantes
}

function estadoCasilla({ records, sucursal, type, cfgSub, monthKey, cerrado }) {
  const hay = records.some(
    (r) =>
      r.estado !== "eliminada" &&
      r.sucursal === sucursal &&
      r.type === type &&
      String(r.date).startsWith(monthKey) &&
      corresponde(r, cfgSub, type),
  );
  if (hay) return "cargado";
  return cerrado ? "pendiente" : "pendiente-soft";
}

/** Estado de la columna colapsada, a partir de los de sus subcategorías. */
export function estadoAgregado(estados) {
  if (estados.length === 0) return "na";
  if (estados.every((s) => s === "cargado")) return "cargado";
  if (estados.includes("pendiente")) return "pendiente";
  if (estados.includes("pendiente-soft")) return "pendiente-soft";
  return "na";
}

/** Etiqueta de una subcategoría configurada, según su tipo. */
export function etiquetaSubcat(type, cfgSub) {
  if (!cfgSub) return "";
  if (type === "electricidad") {
    if (cfgSub.sistemaElectrico) return sistemaLabel(cfgSub.sistemaElectrico);
    return cfgSub.proveedor === OTRO ? cfgSub.proveedorCustom || "—" : cfgSub.proveedor || "—";
  }
  if (type === "combustible") return tipoCombLabel(cfgSub.tipo, cfgSub.tipoCustom);
  if (type === "agua") return tipoAguaLabel(cfgSub.tipo, cfgSub.tipoCustom);
  if (type === "refrigerantes") {
    return cfgSub.tipo === OTRO ? cfgSub.tipoCustom || "Otro" : tipoRefriLabel(cfgSub.tipo);
  }
  return "—";
}

/**
 * Una fila por sucursal activa, con el estado de cada tipo y subcategoría, más el
 * conteo de casillas configuradas y cargadas.
 */
export function construirMatriz({ sucursales, records, monthKey, mesActual }) {
  const cerrado = periodoCerrado(monthKey, mesActual);
  const filas = (sucursales || [])
    .filter((s) => s.activa)
    .map((suc) => {
      const porTipo = {};
      let configuradas = 0;
      let cargadas = 0;
      for (const t of TIPOS_MATRIZ) {
        const cfg = suc.items?.[t.id];
        if (!cfg?.activo || cfg.subcats.length === 0) {
          porTipo[t.id] = { active: false, subcats: [] };
          continue;
        }
        const subcats = cfg.subcats.map((cfgSub) => ({
          cfgSub,
          status: estadoCasilla({ records, sucursal: suc.nombre, type: t.id, cfgSub, monthKey, cerrado }),
        }));
        configuradas += subcats.length;
        cargadas += subcats.filter((s) => s.status === "cargado").length;
        porTipo[t.id] = { active: true, subcats };
      }
      return { suc, porTipo, configuradas, cargadas };
    });

  // Cuántas columnas necesita cada tipo al expandirse: el máximo de
  // subcategorías entre todas las sucursales, para que la tabla quede alineada.
  const anchoPorTipo = {};
  for (const t of TIPOS_MATRIZ) {
    anchoPorTipo[t.id] = Math.max(
      1,
      ...filas.map((f) => f.porTipo[t.id]?.subcats.length || 0),
    );
  }

  return { filas, anchoPorTipo, cerrado };
}

/** Semáforo de la fila. */
export function badgeFila({ configuradas, cargadas }) {
  if (configuradas === 0) return { kind: "neutral", label: "Sin config" };
  if (cargadas === 0) return { kind: "neutral", label: "Sin carga" };
  if (cargadas === configuradas) return { kind: "success", label: "Al día" };
  return { kind: "info", label: `${cargadas}/${configuradas}` };
}
