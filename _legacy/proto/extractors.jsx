// extractors.jsx — real PDF / Excel parsers, ported 1:1 from
// `lector_automático_facturas_(1).ipynb` and `appscript.txt`.
// Exposes `window.rcExtract(file, provider)` → Promise<row[]>

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

async function rcPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // Read up to 2 pages — Enel/Aguas Andinas relevant info is on page 1
  // but the line-cost line sometimes wraps to page 2 on long bills.
  const pages = [];
  for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    pages.push(content.items);
  }
  const allItems = [].concat(...pages);

  // Group items by Y coordinate (visual row), like pdfplumber's extract_text.
  // pdf.js returns transform = [scaleX, skewX, skewY, scaleY, x, y].
  const TOL = 2.5;
  const lines = [];
  for (const it of allItems) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    let bucket = lines.find((l) => Math.abs(l.y - y) <= TOL);
    if (!bucket) { bucket = { y, items: [] }; lines.push(bucket); }
    bucket.items.push(it);
  }
  // Sort lines top→bottom; within a line, left→right
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.transform[4] - b.transform[4]);

  const lined = lines.map((l) => l.items.map((i) => i.str).join(" ")).join("\n");
  const flat = lined.replace(/\s+/g, " ").trim();
  return { flat, lined, combined: flat + "\n" + lined };
}

// ----- Período facturado → punto medio -------------------------------------
// El mes del Registro es el mes predominante del período de lectura; el punto
// medio del período siempre cae en él. Devuelve null si el par no parece un
// ciclo de facturación real (mensual/bimestral).
function rcPeriodoMedio(sIni, sFin) {
  const parse = (s) => {
    const [d, m, y] = s.split("/").map(Number);
    return new Date(y, m - 1, d);
  };
  const a = parse(sIni), b = parse(sFin);
  if (isNaN(a) || isNaN(b)) return null;
  const dias = (b - a) / 86400000;
  if (dias < 15 || dias > 62) return null;
  const mid = new Date((a.getTime() + b.getTime()) / 2);
  const iso = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { inicio: iso(a), fin: iso(b), media: iso(mid) };
}

// ----- Enel parser (replica del notebook) ---------------------------------
function rcExtraerEnel(textBundle) {
  const texto = textBundle.combined;
  const out = {
    numeroCliente: "",
    fecha: "",
    periodoInicio: "",
    periodoFin: "",
    consumo: 0,
    costo: 0,
  };

  // A. Número de Cliente — la etiqueta "Número de cliente" NO está en la capa de
  // texto del PDF (es vector), y pdf.js ordena por coordenada → la caja "RUT:
  // 96800570-7" sale primero. Por eso no se puede anclar a etiqueta ni confiar
  // en el orden. Estrategia: juntar todos los XXXXXX-X, descartar el RUT fijo de
  // Enel (96800570-7) y preferir el formato de cliente (6-7 dígitos + DV); la
  // Ruta (ej. 0762-0, 4 díg) y el RUT (8 díg) quedan fuera.
  const RUT_ENEL = "968005707";
  const candidatos = (texto.match(/\d{4,8}-[\dkK]/g) || [])
    .filter(x => x.replace(/\D/g, "") !== RUT_ENEL);
  const cliente = candidatos.find(x => /^\d{6,7}-[\dkK]$/.test(x)) || candidatos[0];
  if (cliente) out.numeroCliente = cliente;

  // B. Período de lectura → fecha = punto medio (mes predominante).
  // En el text layer las etiquetas "Desde"/"Hasta" quedan en una línea
  // distinta a las fechas, así que no se puede anclar a la etiqueta: el par
  // de fechas adyacentes es el período de lectura.
  let periodo = null;
  const mDesde = texto.match(/Desde\s*(\d{2}\/\d{2}\/\d{4})\s*(?:Hasta\s*)?(\d{2}\/\d{2}\/\d{4})/i);
  if (mDesde) periodo = rcPeriodoMedio(mDesde[1], mDesde[2]);
  if (!periodo) {
    const rePar = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/g;
    let mPar;
    while ((mPar = rePar.exec(texto))) {
      periodo = rcPeriodoMedio(mPar[1], mPar[2]);
      if (periodo) break;
    }
  }
  if (periodo) {
    out.fecha = periodo.media;
    out.periodoInicio = periodo.inicio;
    out.periodoFin = periodo.fin;
  } else {
    // Fallback legado: alguna fecha suelta de la boleta.
    let mFecha = texto.match(/Desde\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (!mFecha) mFecha = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (mFecha) {
      const [d, m, y] = mFecha[1].split("/");
      out.fecha = `${y}-${m}-${d}`;
    }
  }

  // C. Consumo
  if (/No Facturado/i.test(texto)) {
    out.consumo = 0;
  } else {
    const mCons = texto.match(/Electricidad Consumida\s*\(?\s*(\d+)\s*kWh/i);
    if (mCons) out.consumo = parseInt(mCons[1], 10);
    else {
      const alt = texto.match(/(\d+)\s*kWh/);
      if (alt) out.consumo = parseInt(alt[1], 10);
    }
  }

  // D. Costo — Total Monto Neto.
  // Notebook strategy: scan lines, find the one whose label matches, take the
  // last number on that line. Same regex as the original Python script.
  const lineas = textBundle.lined.split("\n");
  const patron = /Total\s+Monto\s+Neto/i;
  const numRe  = /(?<![\d.\-])(\d{1,3}(?:\.\d{3})*|\d+)(?![\d.\-])/g;
  for (const linea of lineas) {
    if (patron.test(linea)) {
      const montos = linea.match(numRe);
      if (montos && montos.length) {
        out.costo = parseInt(montos[montos.length - 1].replace(/\./g, ""), 10) || 0;
        break;
      }
    }
  }
  // Fallback: maybe the label and the value ended up in adjacent lines.
  // Find the index of the line with the label and check the following line.
  if (!out.costo) {
    for (let i = 0; i < lineas.length; i++) {
      if (patron.test(lineas[i])) {
        for (let j = i; j < Math.min(i + 3, lineas.length); j++) {
          const montos = lineas[j].match(numRe);
          if (montos && montos.length) {
            out.costo = parseInt(montos[montos.length - 1].replace(/\./g, ""), 10) || 0;
            if (out.costo) break;
          }
        }
        break;
      }
    }
  }

  return out;
}

// ----- CGE parser --------------------------------------------------------
// Réplica del script Python extractor_cge.py. Soporta:
//   - N° Factura tras "FACTURA ELECTRONICA Nº <folio>".
//   - N° Cliente en la línea anterior a "Fecha de emisión".
//   - Consumo: "Consumo total del mes = 20.440 kWh" o fallback
//     "Electricidad Consumida (20.440 kWh)".
//   - Fecha: fin del período de lectura ("01/01/2026 - 31/01/2026" → la 2a).
//   - Total a pagar: "Total a pagar $ 4.778.200".
function rcExtraerCGE(textBundle) {
  const texto = textBundle.combined;
  const linedTexto = textBundle.lined;
  const out = { numeroCliente: "", fecha: "", periodoInicio: "", periodoFin: "", consumo: 0, costo: 0 };

  // N° Cliente. La boleta CGE es de DOBLE COLUMNA y pdf.js agrupa el texto por
  // coordenada Y, por lo que mezcla la columna izquierda con la derecha y rompe
  // la adyacencia "6061042 \n Fecha de emisión" (que sí se da en pdfplumber).
  // Estrategia en capas, de más a menos robusta:
  //  1) Número (6-8 díg) seguido de una fecha "DD Mmm YYYY" → fila del cupón /
  //     vencimiento ("6061042 08 Jun 2026"). Misma fila visual → sobrevive al
  //     reordenamiento por columnas.
  //  2) Adyacencia a "Fecha de emisión" (layout tipo pdfplumber).
  //  3) Primer 6-8 dígitos que NO sea el folio de la factura.
  let mCli = texto.match(/\b(\d{6,8})\b\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/);
  if (!mCli) mCli = linedTexto.match(/\n(\d{6,8})\s*\n\s*Fecha de emisi[oó]n/i);
  if (!mCli) mCli = linedTexto.match(/(\d{6,8})\s*\n\s*Fecha de emisi[oó]n/i);
  if (!mCli) mCli = texto.match(/\b(\d{6,8})\b[^\d]{0,40}Fecha de emisi[oó]n/i);
  if (mCli) {
    out.numeroCliente = mCli[1];
  } else {
    // Fallback: excluir el folio de "FACTURA ELECTRONICA Nº <folio>" y tomar el
    // primer número de 6-8 dígitos restante (el N° de medidor de la pág. 2 llega
    // después del cliente en el orden de lectura).
    const mFolio = texto.match(/FACTURA\s+ELECTR[OÓ]NICA\s*N[º°o]?\s*(\d{6,9})/i);
    const folio = mFolio ? mFolio[1] : "";
    const cand = (texto.match(/\b\d{6,8}\b/g) || []).filter(x => x !== folio)[0];
    if (cand) out.numeroCliente = cand;
  }

  // Fecha: punto medio del período de lectura (mes predominante).
  const mFecha = texto.match(/Per[ií]odo de lectura:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (mFecha) {
    const periodo = rcPeriodoMedio(mFecha[1], mFecha[2]);
    if (periodo) {
      out.fecha = periodo.media;
      out.periodoInicio = periodo.inicio;
      out.periodoFin = periodo.fin;
    } else {
      const [d, m, y] = mFecha[2].split("/");
      out.fecha = `${y}-${m}-${d}`;
    }
  }

  // Consumo en kWh — preferir "Consumo total del mes", fallback al patrón Enel.
  let mCons = texto.match(/Consumo total del mes\s*=\s*([\d.]+)\s*kWh/i);
  if (!mCons) mCons = texto.match(/Electricidad Consumida\s*\(\s*([\d.]+)\s*kWh\s*\)/i);
  if (mCons) {
    out.consumo = parseInt(mCons[1].replace(/\./g, ""), 10) || 0;
  }

  // Total a pagar.
  const mTotal = texto.match(/Total a pagar\s*\$\s*([\d.]+)/i);
  if (mTotal) {
    out.costo = parseInt(String(mTotal[1]).replace(/\./g, ""), 10) || 0;
  }

  return out;
}

// ----- Aguas Andinas parser ----------------------------------------------
const RC_MESES_CL = { ENE:"01", FEB:"02", MAR:"03", ABR:"04", MAY:"05", JUN:"06",
                      JUL:"07", AGO:"08", SEP:"09", OCT:"10", NOV:"11", DIC:"12" };
// "28-MAY-2025" → "28/05/2025" (formato que espera rcPeriodoMedio)
function rcFechaMesNombre(dia, mesStr, anio) {
  return `${dia}/${RC_MESES_CL[mesStr.toUpperCase()] || "01"}/${anio}`;
}

function rcExtraerAguas(textBundle) {
  const texto = textBundle.combined;
  const out = { numeroCliente: "", fecha: "", periodoInicio: "", periodoFin: "", consumo: 0, costo: 0 };

  let mCli = texto.match(/Cuenta es:\s*\n*\s*([0-9\-]+)/i);
  if (!mCli) mCli = texto.match(/cuenta[^\d]*([0-9\-]+)/i);
  if (!mCli) mCli = texto.match(/Nro de cuenta[^\d]*(\d+-[0-9Kk])/i);
  if (mCli) out.numeroCliente = mCli[1].trim();

  // Fecha: período LECTURA ANTERIOR → LECTURA ACTUAL, punto medio (mes
  // predominante). Fallback legado: VENCIMIENTO → LECTURA ACTUAL.
  const reFechaMes = (label) =>
    texto.match(new RegExp(label + "\\s+(\\d{2})-([A-Za-z]{3})-(\\d{4})", "i"));
  const mActual = reFechaMes("LECTURA ACTUAL");
  const mAnterior = reFechaMes("LECTURA ANTERIOR");
  let periodo = null;
  if (mActual && mAnterior) {
    periodo = rcPeriodoMedio(
      rcFechaMesNombre(mAnterior[1], mAnterior[2], mAnterior[3]),
      rcFechaMesNombre(mActual[1], mActual[2], mActual[3])
    );
  }
  if (periodo) {
    out.fecha = periodo.media;
    out.periodoInicio = periodo.inicio;
    out.periodoFin = periodo.fin;
  } else {
    let mFecha = texto.match(/VENCIMIENTO\s+(\d{2})-([A-Za-z]{3})-(\d{4})/i);
    if (!mFecha) mFecha = mActual;
    if (mFecha) {
      const [, dia, mesStr, anio] = mFecha;
      out.fecha = `${anio}-${RC_MESES_CL[mesStr.toUpperCase()] || "01"}-${dia}`;
    }
  }

  let mCons = texto.match(/RECOLECCION AGUAS SERVIDAS\s*([0-9\.]+)/);
  if (mCons) out.consumo = parseInt(mCons[1].replace(/\./g, ""), 10) || 0;
  else {
    mCons = texto.match(/DIFERENCIA DE LECTURAS[^\d]*(\d+)/i);
    if (mCons) out.consumo = parseInt(mCons[1], 10) || 0;
  }

  let mVenta = texto.match(/TOTAL VENTA\s*\$?\s*([0-9\.]+)/);
  if (mVenta) out.costo = parseInt(mVenta[1].replace(/\./g, ""), 10) || 0;
  else {
    const mNetoIva = texto.replace(/\./g, "").match(/neto, sin IVA.*?\$([0-9]+).*?IVA.*?\$([0-9]+)/);
    if (mNetoIva) out.costo = (parseInt(mNetoIva[1], 10) || 0) + (parseInt(mNetoIva[2], 10) || 0);
  }

  return out;
}

// ----- Aguas del Valle parser --------------------------------------------
// Replica del script Python extractor_aguasdelvalle.py.
//
// Estructura del PDF (capa de texto):
//   - N° cliente: "1243948-2" (7 dígitos + guión + dígito verificador).
//   - Fila de lecturas: <fecha_actual> <fecha_anterior> <prox_estimada>
//       <lect_actual> <lect_anterior> <consumo_cliente> <consumo_a_facturar>
//     Campo 6 = consumo_cliente (m³).
//   - Línea con folio: "<fecha> <folio>" donde folio = 6-8 dígitos sin guión.
//   - Total a pagar: "$ 931.170".
function rcExtraerAguasDelValle(textBundle) {
  const texto = textBundle.combined;
  const out = { numeroCliente: "", fecha: "", periodoInicio: "", periodoFin: "", consumo: 0, costo: 0 };

  // A. N° cliente — formato XXXXXXX-X.
  const mCli = texto.match(/\b(\d{7}-\d)\b/);
  if (mCli) out.numeroCliente = mCli[1];

  // B. Fila de lecturas: "<actual> <anterior> <próx. estimada> <lect actual>
  // <lect anterior> <consumo cliente> <a facturar>". Período = anterior→actual;
  // fecha = punto medio (mes predominante).
  const reFila = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)/;
  const mFila = texto.match(reFila);
  if (mFila) {
    const periodo = rcPeriodoMedio(mFila[2], mFila[1]);
    if (periodo) {
      out.fecha = periodo.media;
      out.periodoInicio = periodo.inicio;
      out.periodoFin = periodo.fin;
    } else {
      const [d, m, y] = mFila[1].split("/");
      out.fecha = `${y}-${m}-${d}`;
    }
    const consStr = String(mFila[6] || "").replace(/\./g, "").replace(",", ".");
    const cons = parseFloat(consStr);
    if (!isNaN(cons)) out.consumo = cons;
  }

  // C. Total a pagar — "$ 931.170" → 931170.
  const mTotal = texto.match(/\$\s*([\d.]+)/);
  if (mTotal) {
    out.costo = parseInt(String(mTotal[1]).replace(/\./g, ""), 10) || 0;
  }

  return out;
}

// ----- ESVAL parser (agua) ------------------------------------------------
// Boleta electrónica ESVAL (Viña / V Región). Estructura del text layer:
//   - N° Cliente: formato NNNNNN-DV (6-7 díg + guión + dígito o "K", ej.
//     "865915-K"). En la capa de texto suele venir PEGADO a la fecha de
//     emisión ("13-02-2026865915-K"); el patrón NNNNNN-DV no colisiona con el
//     RUT de ESVAL (con puntos: 76.000.739-0), la Ruta de Lectura
//     (10-143-4254-0) ni las fechas (DD-MM-YYYY).
//   - Fechas de Lecturas: "Anterior 10/01/2026 · Actual 10/02/2026" — lecturas
//     mensuales que caen el MISMO día en meses consecutivos → firma del ciclo.
//   - Consumos: "A Facturar 388,00m3"; en detalle "Recolección 388,00 m3" y
//     "Tratamiento 388,00 m3" repiten el volumen total facturado.
//   - Monto: "Monto Total $ 1.031.116" (línea de texto), o "TOTAL A PAGAR" /
//     "Subtotal del mes" como respaldo.
function rcExtraerEsval(textBundle) {
  const texto = textBundle.combined;
  const out = { numeroCliente: "", fecha: "", periodoInicio: "", periodoFin: "", consumo: 0, costo: 0 };

  // A. N° cliente — NNNNNN-DV. El cliente viene tras la fecha de emisión
  // (DD-MM-YYYY), a veces PEGADO ("13-02-2026865915-K"): anclar en la fecha la
  // consume primero y evita que su último dígito se cuele en el número greedy.
  // Fallback: match suelto con lookbehind para no arrastrar un dígito previo.
  let mCli = texto.match(/\d{2}-\d{2}-\d{4}\s*(\d{6,7}-[\dkK])(?![\d-])/);
  if (!mCli) mCli = texto.match(/(?<!\d)(\d{6,7}-[\dkK])(?![\d-])/);
  if (mCli) out.numeroCliente = mCli[1];

  // B. Período de lectura → punto medio (mes predominante). Estrategia por capas:
  //  1) par de fechas con el MISMO día y meses consecutivos (lecturas mensuales).
  //  2) fallback: primer par DD/MM/YYYY con duración de ciclo válida (15-62 d).
  const fechas = texto.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];
  let periodo = null;
  for (let i = 0; i < fechas.length && !periodo; i++) {
    for (let j = 0; j < fechas.length; j++) {
      if (i === j) continue;
      const d1 = Number(fechas[i].slice(0, 2)), d2 = Number(fechas[j].slice(0, 2));
      if (d1 !== d2) continue;
      const p = rcPeriodoMedio(fechas[i], fechas[j]) || rcPeriodoMedio(fechas[j], fechas[i]);
      if (p) { periodo = p; break; }
    }
  }
  if (!periodo) {
    for (let i = 0; i < fechas.length && !periodo; i++)
      for (let j = i + 1; j < fechas.length; j++) {
        const p = rcPeriodoMedio(fechas[i], fechas[j]) || rcPeriodoMedio(fechas[j], fechas[i]);
        if (p) { periodo = p; break; }
      }
  }
  if (periodo) {
    out.fecha = periodo.media;
    out.periodoInicio = periodo.inicio;
    out.periodoFin = periodo.fin;
  }

  // C. Consumo facturado (m³). "A Facturar" → detalle "Recolección"/"Tratamiento".
  const parseM3 = (s) => parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0;
  let mCons = texto.match(/A\s*Facturar\s*([\d.,]+)\s*m3/i);
  if (!mCons) mCons = texto.match(/Recolecci[oó]n\s*([\d.,]+)\s*m3/i);
  if (!mCons) mCons = texto.match(/Tratamiento\s*([\d.,]+)\s*m3/i);
  if (mCons) out.consumo = parseM3(mCons[1]);

  // D. Costo — "Monto Total", respaldo "Total a pagar" / "Subtotal del mes".
  let mTot = texto.match(/Monto\s*Total\s*\$?\s*([\d.]+)/i);
  if (!mTot) mTot = texto.match(/Total\s*a\s*Pagar\s*\$?\s*([\d.]+)/i);
  if (!mTot) mTot = texto.match(/Subtotal del mes\s*\$?\s*([\d.]+)/i);
  if (mTot) out.costo = parseInt(String(mTot[1]).replace(/\./g, ""), 10) || 0;

  return out;
}

// ----- Chilquinta parser (electricidad) -----------------------------------
// Boleta electrónica Chilquinta (V Región). Layout con etiquetas en el text
// layer (a diferencia de Enel):
//   - "N° CLIENTE: 541947 - 6" (espacios alrededor del guión).
//   - "LECTURAS Desde 04 may 2021 al 04 jun 2021" (mes en español, minúscula).
//   - "Electricidad consumida 1.863 kWh" = energía facturada (NO el 'Consumo'
//     de la tabla de lecturas, que es la dif. de registros del medidor).
//   - Total a pagar junto al vencimiento: "01 jul 2021 $ 676.022"; respaldo
//     "asciende a $ 676.022".
// "04 may 2021" → "04/05/2021" (formato que espera rcPeriodoMedio).
function rcFechaTextoCL(s) {
  const m = String(s).trim().match(/(\d{1,2})\s+([A-Za-zñÑ]{3,})\s+(\d{4})/);
  if (!m) return null;
  const mes = RC_MESES_CL[m[2].slice(0, 3).toUpperCase()];
  if (!mes) return null;
  return `${String(m[1]).padStart(2, "0")}/${mes}/${m[3]}`;
}

function rcExtraerChilquinta(textBundle) {
  const texto = textBundle.combined;
  const out = { numeroCliente: "", fecha: "", periodoInicio: "", periodoFin: "", consumo: 0, costo: 0 };

  // A. N° Cliente — etiquetado, con espacios alrededor del guión.
  const mCli = texto.match(/N[°º]?\s*CLIENTE:?\s*(\d{5,7})\s*-\s*([\dkK])/i);
  if (mCli) out.numeroCliente = mCli[1] + "-" + mCli[2];

  // B. Período de lectura → punto medio. Fallback: FECHA EMISIÓN.
  const mPer = texto.match(/Desde\s+(\d{1,2}\s+[A-Za-zñÑ]{3,}\s+\d{4})\s+al\s+(\d{1,2}\s+[A-Za-zñÑ]{3,}\s+\d{4})/i);
  let periodo = null;
  if (mPer) {
    const ini = rcFechaTextoCL(mPer[1]), fin = rcFechaTextoCL(mPer[2]);
    if (ini && fin) periodo = rcPeriodoMedio(ini, fin);
  }
  if (periodo) {
    out.fecha = periodo.media;
    out.periodoInicio = periodo.inicio;
    out.periodoFin = periodo.fin;
  } else {
    const mEmis = texto.match(/FECHA\s*EMISI[OÓ]N:?\s*(\d{1,2}\s+[A-Za-zñÑ]{3,}\s+\d{4})/i);
    const f = mEmis && rcFechaTextoCL(mEmis[1]);
    if (f) { const [d, m, y] = f.split("/"); out.fecha = `${y}-${m}-${d}`; }
  }

  // C. Consumo — "Electricidad consumida 1.863 kWh".
  const mCons = texto.match(/Electricidad consumida\s+([\d.]+)\s*kWh/i);
  if (mCons) out.consumo = parseInt(mCons[1].replace(/\./g, ""), 10) || 0;

  // D. Costo — total a pagar junto al vencimiento; respaldo "asciende a $".
  let mTot = texto.match(/\d{1,2}\s+[A-Za-zñÑ]{3,}\s+\d{4}\s+\$\s*([\d.]+)/);
  if (!mTot) mTot = texto.match(/asciende a\s*\$\s*([\d.]+)/i);
  if (mTot) out.costo = parseInt(String(mTot[1]).replace(/\./g, ""), 10) || 0;

  return out;
}

// ----- Iconstruye Excel parser (replica de appscript.txt) ----------------
const RC_EXCEL = {
  FILA_DATOS: 14,
  COL_FECHA: 3, COL_PROVEEDOR: 9, COL_CANTIDAD: 16, COL_SUBTOTAL: 21,
  KG_POR_CILINDRO: 45,
};
function rcExcelDate(val) {
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d)) return d;
  }
  return null;
}
function rcFinDeMes(y, m) {
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
async function rcParseIconstruye(file, tipoCombust /* "Petróleo Diesel" | "Gas" */) {
  if (!window.XLSX) throw new Error("XLSX library no cargada");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const datos = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const desde = RC_EXCEL.FILA_DATOS - 1;
  const filas = datos.slice(desde);
  const filtradas = filas.filter((fila) => {
    const ocNo = fila[0];
    const fecha = rcExcelDate(fila[RC_EXCEL.COL_FECHA - 1]);
    const cantidad = fila[RC_EXCEL.COL_CANTIDAD - 1];
    return ocNo !== "" && ocNo != null &&
      fecha instanceof Date && fecha.getFullYear() > 1990 &&
      typeof cantidad === "number" && cantidad > 0;
  });
  if (!filtradas.length) return [];

  // Group by año-mes + proveedor
  const grupos = {};
  filtradas.forEach((fila) => {
    const fecha = rcExcelDate(fila[RC_EXCEL.COL_FECHA - 1]);
    const proveedor = fila[RC_EXCEL.COL_PROVEEDOR - 1] || "";
    const cantidad = fila[RC_EXCEL.COL_CANTIDAD - 1];
    const subtotal = fila[RC_EXCEL.COL_SUBTOTAL - 1];
    const y = fecha.getFullYear(), m = fecha.getMonth() + 1;
    const clave = `${y}-${String(m).padStart(2, "0")}|${proveedor}`;
    if (!grupos[clave]) grupos[clave] = { y, m, proveedor, cantidad: 0, costo: 0 };
    grupos[clave].cantidad += cantidad;
    grupos[clave].costo += (typeof subtotal === "number" ? subtotal : 0);
  });
  return Object.values(grupos).map((g) => {
    const consumo = tipoCombust === "Gas"
      ? g.cantidad * RC_EXCEL.KG_POR_CILINDRO
      : g.cantidad;
    return {
      fecha: rcFinDeMes(g.y, g.m),
      proveedor: g.proveedor,
      cantidad: consumo,
      costo: Math.round(g.costo),
      tipoCombustible: tipoCombust,
    };
  });
}

// ----- Public entry point ------------------------------------------------
// Returns an array of preview-row-shaped objects
async function rcExtract(file, provider) {
  const name = file.name.toLowerCase();
  const ext = (name.match(/\.([^.]+)$/) || [])[1];
  if (ext === "pdf") {
    const text = await rcPdfText(file);
    let datos, type;
    if (provider.id === "cge") {
      datos = rcExtraerCGE(text); type = "electricidad";
    } else if (provider.id === "chilquinta") {
      datos = rcExtraerChilquinta(text); type = "electricidad";
    } else if (provider.id === "enel" || (provider.type === "electricidad" && provider.id !== "generic")) {
      datos = rcExtraerEnel(text); type = "electricidad";
    } else if (provider.id === "aguas-del-valle") {
      datos = rcExtraerAguasDelValle(text); type = "agua";
    } else if (provider.id === "esval") {
      datos = rcExtraerEsval(text); type = "agua";
    } else if (provider.id === "aguas-andinas" || provider.type === "agua") {
      datos = rcExtraerAguas(text); type = "agua";
    } else if (provider.id === "generic") {
      // Try Enel pattern first, then Aguas
      datos = rcExtraerEnel(text);
      if (datos.numeroCliente || datos.consumo) type = "electricidad";
      else { datos = rcExtraerAguas(text); type = "agua"; }
    } else {
      // Default to type guess
      type = provider.type === "any" ? "electricidad" : provider.type;
      datos = type === "agua" ? rcExtraerAguas(text) : rcExtraerEnel(text);
    }
    const status = (!datos.fecha || !datos.numeroCliente)
      ? "warn"
      : (!datos.consumo ? "warn" : "ok");
    return [{
      date: datos.fecha || "",
      periodoInicio: datos.periodoInicio || "",
      periodoFin: datos.periodoFin || "",
      sucursal: "",                       // unknown from PDF; user must complete
      type,
      subcat: null,
      provider: provider.name,
      cantidad: datos.consumo || "",
      costo: datos.costo || "",
      status,
      numeroCliente: datos.numeroCliente || "",
      sourceFile: file.name,
    }];
  }
  if (ext === "xlsx" || ext === "xls") {
    // Decide if Petróleo or Gas — guess by provider name / filename
    let tipoCombust = "Petróleo Diesel";
    if (/gas/i.test(provider.name) || /gas/i.test(name)) tipoCombust = "Gas";
    const grupos = await rcParseIconstruye(file, tipoCombust);
    if (!grupos.length) {
      throw new Error("Sin filas válidas desde fila 14");
    }
    const subcatId = tipoCombust === "Gas" ? "glp" : "diesel";
    return grupos.map((g) => ({
      date: g.fecha,
      sucursal: "",
      type: "combustible",
      subcat: subcatId,
      provider: g.proveedor || provider.name,
      cantidad: g.cantidad,
      costo: g.costo,
      status: "ok",
      sourceFile: file.name,
    }));
  }
  throw new Error("Tipo de archivo no soportado");
}

window.rcExtract = rcExtract;
