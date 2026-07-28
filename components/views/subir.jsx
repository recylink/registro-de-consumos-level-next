"use client";

// Subir documento: proveedor → cola de archivos → revisión. Portado de
// proto/upload.jsx.
//
// Cambio de fondo: la extracción ya no ocurre en el navegador. Cada archivo se
// manda al Server Action, que lo parsea con pdfjs/xlsx en el servidor y devuelve
// las filas. El navegador no descarga ninguna librería de parsing.
//
// Se elimina la barra de progreso simulada del prototipo (un setInterval que
// subía un porcentaje al azar más un setTimeout de 800 ms "para que la animación
// alcance a verse"). Ahora hay una espera real, así que el estado que se muestra
// es el verdadero: procesando o listo.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Btn } from "@/components/ui/controls";
import { Card, Chip, SectionHead, Steps, TypeIndicator } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { SubirPreview } from "@/components/views/subir-preview";
import { extraerDocumentoAction } from "@/app/actions/extraer";
import { submitUploadAction } from "@/app/actions/records";
import { TYPES } from "@/lib/domain/catalog";
import { nextRecordId } from "@/lib/domain/ids";
import { proveedoresDisponibles } from "@/lib/domain/proveedores";
import { resolveByNumCliente } from "@/lib/domain/sucursales";

const PASOS = ["Proveedor", "Subir", "Revisar"];

const ICONO_ARCHIVO = {
  pdf: "picture_as_pdf",
  xlsx: "table_view",
  csv: "table_view",
  image: "image",
  other: "description",
};

function tipoDeArchivo(nombre) {
  const n = nombre.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "xlsx";
  if (n.endsWith(".csv")) return "csv";
  if (/\.(jpg|jpeg|png)$/.test(n)) return "image";
  return "other";
}

const tamano = (bytes) =>
  !bytes ? "—" : bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";

function PasoProveedor({ sucursales, onElegir }) {
  const disponibles = proveedoresDisponibles(sucursales);

  return (
    <div>
      <SectionHead
        eyebrow="Subir documento · paso 1 de 3"
        title="¿De qué proveedor es el documento?"
        sub="Sólo aparecen los proveedores configurados en alguna sucursal y con extractor disponible."
        right={
          <Link className="prt-btn" href="/registrar">
            <Icon name="arrow_back" />
            Volver
          </Link>
        }
      />
      <div style={{ marginBottom: 22 }}>
        <Steps items={PASOS} current={0} />
      </div>

      {disponibles.length === 0 ? (
        <Card>
          <div className="prt-row" style={{ gap: 10, alignItems: "center" }}>
            <Icon name="info" size={18} style={{ color: "var(--rl-gray-500)" }} />
            <span className="prt-muted">
              Ningún proveedor configurado coincide con un extractor disponible. Elige un proveedor del
              catálogo en <Link href="/configuracion">Configuración → editar sucursal</Link>.
            </span>
          </div>
        </Card>
      ) : (
        <div className="rc-proveedor-grid">
          {disponibles.map((p) => (
            <button key={p.id} className="prt-provider" onClick={() => onElegir(p)}>
              <div className="prt-spread">
                <div className="logo">{p.initials}</div>
                {TYPES[p.type] ? <TypeIndicator type={p.type} /> : <Chip size="sm">Genérico</Chip>}
              </div>
              <div className="prt-h4" style={{ marginTop: 4 }}>{p.name}</div>
              <div className="prt-hint" style={{ fontSize: 12 }}>{p.examples}</div>
            </button>
          ))}
          <div className="prt-provider rc-provider-nota">
            <div className="prt-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
              <Icon name="info" size={18} style={{ color: "var(--rl-gray-500)" }} />
              <span className="prt-h4">¿Te falta un proveedor?</span>
            </div>
            <div className="prt-hint" style={{ fontSize: 12, lineHeight: 1.45 }}>
              Escríbele a tu CSE y lo sumamos.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaCola({ archivo, onQuitar }) {
  return (
    <div className="prt-queue-row">
      <div className="file-ico">
        <Icon name={ICONO_ARCHIVO[archivo.kind]} />
      </div>
      <div className="prt-grow">
        <div className="filename">{archivo.name}</div>
        <div className="meta">
          {tamano(archivo.size)}
          {archivo.rows?.length ? ` · ${archivo.rows.length} registros detectados` : ""}
        </div>
      </div>
      {archivo.status === "procesando" && (
        <div className="prt-row" style={{ gap: 6 }}>
          <span className="prt-spinner" />
          <span className="prt-hint" style={{ minWidth: 120 }}>Extrayendo datos…</span>
        </div>
      )}
      {archivo.status === "listo" && <Chip kind="success" icon="check">Listo</Chip>}
      {archivo.status === "revisar" && <Chip kind="warning" icon="warning">Revisar</Chip>}
      {archivo.status === "error" && (
        <Chip kind="error" icon="error">{archivo.error || "Error al extraer"}</Chip>
      )}
      <button className="ob-icon-btn sm rc-icon-hover" onClick={onQuitar} title="Quitar archivo">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

function PasoArchivos({ proveedor, cola, onAgregar, onQuitar, onLimpiar, onVolver, onRevisar }) {
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef(null);

  const listos = cola.filter((f) => f.status === "listo" || f.status === "revisar").length;
  const procesando = cola.filter((f) => f.status === "procesando").length;
  const conError = cola.filter((f) => f.status === "error").length;

  const soltar = (e) => {
    e.preventDefault();
    setArrastrando(false);
    onAgregar(Array.from(e.dataTransfer?.files || []));
  };

  const zonaProps = {
    onDrop: soltar,
    onDragOver: (e) => {
      e.preventDefault();
      setArrastrando(true);
    },
    onDragLeave: (e) => {
      e.preventDefault();
      setArrastrando(false);
    },
    onClick: () => inputRef.current?.click(),
    style: { cursor: "pointer" },
  };

  return (
    <div>
      <SectionHead
        eyebrow="Subir documento · paso 2 de 3"
        title={`Sube tus archivos · ${proveedor.name}`}
        sub="Arrastra los PDFs o Excel acá. Cada archivo se procesa por separado."
        right={
          <Btn kind="ghost" icon="arrow_back" onClick={onVolver}>Cambiar proveedor</Btn>
        }
      />
      <div style={{ marginBottom: 22 }}>
        <Steps items={PASOS} current={1} />
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.xlsx,.xls"
        className="prt-vh"
        onChange={(e) => {
          onAgregar(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />

      {cola.length === 0 ? (
        <div className={"prt-dropzone" + (arrastrando ? " active" : "")} {...zonaProps}>
          <Icon name="cloud_upload" size={48} />
          <div>
            <div className="prt-h3">
              {arrastrando ? "Suelta para subir" : "Arrastra tus archivos aquí"}
            </div>
            <div className="prt-muted" style={{ marginTop: 4 }}>
              o <span className="rc-link-inline">elige desde tu equipo</span>
            </div>
          </div>
          <div className="prt-hint">PDF · Excel</div>
        </div>
      ) : (
        <div className="prt-stack-md">
          <div
            className={"prt-dropzone" + (arrastrando ? " active" : "")}
            {...zonaProps}
            style={{ ...zonaProps.style, padding: "24px 20px" }}
          >
            <Icon name="cloud_upload" size={28} />
            <div className="prt-h4">
              {arrastrando ? "Suelta para agregar" : "Suelta o haz clic para agregar más archivos"}
            </div>
          </div>

          <Card flush>
            <div className="prt-card-head">
              <div>
                <div className="prt-h3">Cola de procesamiento</div>
                <div className="prt-hint" style={{ marginTop: 2 }}>
                  {cola.length} archivo{cola.length !== 1 ? "s" : ""} · {listos} listo{listos !== 1 ? "s" : ""}
                  {procesando > 0 && ` · ${procesando} procesando`}
                  {conError > 0 && ` · ${conError} con error`}
                </div>
              </div>
              <div className="prt-row" style={{ gap: 8 }}>
                <Btn size="sm" onClick={onLimpiar}>Limpiar todo</Btn>
                <Btn
                  size="sm"
                  kind="primary"
                  iconRight="arrow_forward"
                  disabled={listos === 0 || procesando > 0}
                  onClick={onRevisar}
                >
                  Revisar {listos > 0 ? `${listos} archivo${listos > 1 ? "s" : ""}` : ""}
                </Btn>
              </div>
            </div>
            <div className="prt-stack-sm" style={{ padding: 16, gap: 10 }}>
              {cola.map((f) => (
                <FilaCola key={f.id} archivo={f} onQuitar={() => onQuitar(f.id)} />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export function Subir({ sucursales, hoy }) {
  const router = useRouter();
  const toast = useToast();
  const [paso, setPaso] = useState(1);
  const [proveedor, setProveedor] = useState(null);
  const [cola, setCola] = useState([]);
  const [rows, setRows] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const parchear = (id, patch) =>
    setCola((c) => c.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const agregar = async (files) => {
    if (!files.length) return;
    const nuevos = files.map((file) => ({
      id: nextRecordId(),
      name: file.name,
      size: file.size,
      kind: tipoDeArchivo(file.name),
      status: "procesando",
      file,
      rows: [],
    }));
    setCola((c) => [...c, ...nuevos]);

    // Uno por uno: así un archivo que falla no arrastra a los demás, y el
    // servidor no recibe cinco PDFs a la vez.
    for (const item of nuevos) {
      const fd = new FormData();
      fd.set("file", item.file);
      fd.set("provider", JSON.stringify(proveedor));
      const res = await extraerDocumentoAction(fd);

      if (!res.ok) {
        parchear(item.id, { status: "error", error: res.error });
        continue;
      }
      if (!res.rows?.length) {
        parchear(item.id, { status: "error", error: "Sin datos extraíbles" });
        continue;
      }
      const hayDudas = res.rows.some((r) => r.status === "warn");
      parchear(item.id, { status: hayDudas ? "revisar" : "listo", rows: res.rows });
    }
  };

  // Al pasar a revisión se intenta completar la sucursal por número de cliente:
  // el documento no la trae, pero la configuración sí sabe de quién es esa cuenta.
  const irARevisar = () => {
    const filas = [];
    for (const f of cola) {
      if (f.status !== "listo" && f.status !== "revisar") continue;
      for (const r of f.rows) {
        const row = { id: nextRecordId(), ...r };
        if (!row.sucursal && row.numeroCliente) {
          const match = resolveByNumCliente(sucursales, row.numeroCliente, row.type);
          if (match) {
            row.sucursal = match.sucursal;
            if (match.subcat && !row.subcat) row.subcat = match.subcat;
            if (match.provider) row.provider = match.provider;
          }
        }
        // El estado se recalcula con lo que hay ahora, ya sea por el match o por
        // lo que el usuario complete después.
        row.status = estadoFila(row);
        filas.push(row);
      }
    }
    setRows(filas);
    setPaso(3);
  };

  const actualizarFila = (id, patch) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        next.status = estadoFila(next);
        return next;
      }),
    );

  const duplicarFila = (id) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      if (i < 0) return rs;
      const copia = { ...rs[i], id: nextRecordId() };
      return [...rs.slice(0, i + 1), copia, ...rs.slice(i + 1)];
    });

  const limpiarTodo = () => {
    setCola([]);
    setRows([]);
    setProveedor(null);
    setPaso(1);
  };

  const confirmar = async () => {
    setGuardando(true);
    const guardables = rows.filter((r) => r.status !== "error");

    const fd = new FormData();
    fd.set("providerId", proveedor?.id || "");
    fd.set(
      "records",
      JSON.stringify(
        guardables.map((r) => ({
          id: r.id,
          date: r.date,
          sucursal: r.sucursal,
          type: r.type,
          subcat: r.subcat || null,
          provider: r.provider,
          cantidad: parseFloat(r.cantidad),
          costo: parseFloat(r.costo) || 0,
          unit: TYPES[r.type]?.unit || "",
          origen: "documento",
          estado: "activa",
          numeroCliente: r.numeroCliente || "",
          periodoInicio: r.periodoInicio || "",
          periodoFin: r.periodoFin || "",
          sourceFile: r.sourceFile || null,
        })),
      ),
    );
    // Un archivo puede haber generado varias filas: se sube una sola vez y las
    // filas se enlazan por su nombre.
    const subidos = new Set();
    for (const f of cola) {
      if (f.status === "error" || subidos.has(f.name)) continue;
      if (!guardables.some((r) => r.sourceFile === f.name)) continue;
      subidos.add(f.name);
      fd.append(`file:${f.name}`, f.file);
    }

    const res = await submitUploadAction(fd);
    setGuardando(false);

    if (!res.ok) {
      toast.error("No se pudieron guardar los registros", res.error);
      return;
    }
    for (const p of res.problemas || []) toast.warning("Atención", p);
    toast.success(
      `${res.written} registro${res.written !== 1 ? "s" : ""} guardado${res.written !== 1 ? "s" : ""}`,
      "Los datos ya aparecen en el dashboard.",
    );
    router.push("/dashboard");
  };

  if (paso === 3) {
    return (
      <SubirPreview
        rows={rows}
        sucursales={sucursales}
        hoy={hoy}
        guardando={guardando}
        onUpdate={actualizarFila}
        onDuplicar={duplicarFila}
        onEliminar={(id) => setRows((rs) => rs.filter((r) => r.id !== id))}
        onVolver={() => setPaso(2)}
        onCancelar={limpiarTodo}
        onConfirmar={confirmar}
      />
    );
  }

  if (paso === 2 && proveedor) {
    return (
      <PasoArchivos
        proveedor={proveedor}
        cola={cola}
        onAgregar={agregar}
        onQuitar={(id) => setCola((c) => c.filter((f) => f.id !== id))}
        onLimpiar={() => setCola([])}
        onVolver={() => setPaso(1)}
        onRevisar={irARevisar}
      />
    );
  }

  return (
    <PasoProveedor
      sucursales={sucursales}
      onElegir={(p) => {
        setProveedor(p);
        setPaso(2);
      }}
    />
  );
}

/** Una fila sin sucursal, fecha o cantidad no se puede guardar todavía. */
function estadoFila(row) {
  if (!row.sucursal || !row.date || row.cantidad === "" || row.cantidad == null) return "error";
  if (!row.numeroCliente || row.costo === "" || row.costo == null) return "warn";
  return "ok";
}
