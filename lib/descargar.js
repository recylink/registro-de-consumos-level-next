// Descarga en el navegador de un archivo que armó el servidor.
//
// Los Server Actions no pueden devolver un stream a un <a download>, así que el
// binario viaja en base64 y acá se convierte en Blob. Es el precio de generar el
// Excel en el servidor; a cambio, la librería xlsx (~400 kB) no entra al bundle
// del navegador.

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function descargarBase64(base64, filename, mime = XLSX_MIME) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // El objectURL se libera después del click; revocarlo en el mismo tick corta la
  // descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
