// Generación de ids. Se usan solo en el cliente, al crear entidades desde un
// formulario: dependen del reloj y del azar, así que no pueden correr durante el
// render del servidor sin romper la hidratación.

let seq = 0;

const rand = () => Math.random().toString(36).slice(2, 6);

/**
 * Id de sucursal. Lleva timestamp y azar a propósito: el prototipo usaba un
 * contador que arrancaba en 0 en cada carga de página, así que dos personas
 * creando una sucursal generaban ambas "suc1" y la segunda pisaba a la primera
 * al guardar (el upsert es por id).
 */
export const nextSucId = () => `suc_${Date.now().toString(36)}_${++seq}${rand()}`;

export const nextItemId = () => `itm_${Date.now().toString(36)}_${++seq}`;
export const nextMeterId = () => `med_${Date.now().toString(36)}_${++seq}`;
export const nextReadingId = () => `lec_${Date.now().toString(36)}_${++seq}`;
export const nextRefrigId = () => `rf_${Date.now().toString(36)}_${++seq}`;
export const nextEntryId = () => `ent_${Date.now().toString(36)}_${++seq}`;
export const nextRecordId = () => `r_${Date.now().toString(36)}_${++seq}`;
