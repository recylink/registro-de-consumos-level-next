// Fecha de hoy en hora local. Se usa para topar inputs de fecha/mes que no
// deben admitir futuro.
//
// Ojo: son valores que difieren entre servidor y cliente (zona horaria y
// momento distintos), así que no se usan durante el render de un componente de
// servidor — solo en manejadores y efectos del cliente.

export function todayISO() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function currentMonthISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
