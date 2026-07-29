// foto.jsx — Módulo "Tomar foto" para Base. Una sola vista (FotoHubView) con
// pestañas Nueva / Cola. Completar datos abre una vista aparte (FotoCompleteView).
// Mobile-first: foto al principio del form, solo foto obligatoria, resto opcional.

// Genera un id único corto para identificar trabajos en background.
function newJobId() {
  return "j" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

// ----- Captura (sub-componente de FotoHubView) ---------------------------
const FotoCaptureForm = ({ onUploaded }) => {
  const { state, dispatch } = useApp();

  const sucursales = (state.configSucursales || []).filter(s => s.activa);
  const sucOptions = sucursales.map(s => ({ value: s.nombre, label: s.nombre }));
  const tipoOptions = [
    { value: "electricidad", label: "Electricidad" },
    { value: "combustible",  label: "Combustible" },
    { value: "agua",         label: "Agua" },
    { value: "refrigerantes",label: "Refrigerantes" },
  ];

  const [tipo, setTipo]         = React.useState("");
  const [sucursal, setSucursal] = React.useState("");
  const [periodo, setPeriodo]   = React.useState("");
  const [subcat, setSubcat]     = React.useState("");
  const [consumo, setConsumo]   = React.useState("");
  const [unidad, setUnidad]     = React.useState("");
  const [costo, setCosto]       = React.useState("");
  const [proveedor, setProv]    = React.useState("");
  const [notas, setNotas]       = React.useState("");
  const [file, setFile]         = React.useState(null);
  const [previewUrl, setPrev]   = React.useState("");
  const [error, setError]       = React.useState("");
  const fileInputRef = React.useRef(null);

  // Defaults derivados: unidad sigue al tipo si no se eligió manualmente.
  React.useEffect(() => {
    if (!unidad && tipo && TYPES[tipo]?.unit) setUnidad(TYPES[tipo].unit);
  }, [tipo]);

  const onFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    setPrev(URL.createObjectURL(f));
    setError("");
  };

  const reset = () => {
    setTipo(""); setSucursal(""); setPeriodo("");
    setSubcat(""); setConsumo(""); setUnidad(""); setCosto(""); setProv(""); setNotas("");
    setFile(null); setPrev("");
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canSubmit = !!file;

  // Upload en background: el form se limpia y cambia a Cola al instante,
  // la subida (file→base64→Drive→Sheet) corre en segundo plano.
  const onSubmit = () => {
    if (!canSubmit) return;
    const params = {
      file, tipo, sucursal, periodo,
      subcat, consumo, unidad, costo, proveedor, notas,
    };
    const label = "Subiendo foto" + (file.name ? " · " + file.name : "");
    const jobId = newJobId();
    // 1) limpia form y switchea a Cola — usuario libre de seguir trabajando.
    reset();
    if (onUploaded) onUploaded({ pending: true, jobId });
    // 2) marca job inflight + toast inicial.
    dispatch({ type: "FOTO/JOB_START", job: { id: jobId, kind: "upload", label } });
    dispatch({ type: "TOAST/SHOW", toast: { kind: "info", title: "Subiendo foto…", body: "Sigue trabajando, te aviso al terminar." } });
    // 3) fire-and-forget.
    (async () => {
      try {
        const up = await rcUploadFoto(params);
        dispatch({ type: "FOTO/INVALIDATE" });
        dispatch({ type: "TOAST/SHOW", toast: { kind: "success", title: "Foto subida", body: "Disponible en la cola." } });
        // Notificación por correo (si hay destinatarios configurados).
        try {
          const prev = state.fotos.rows || [];
          const totalPend = prev.filter(r => (r.status || "").toLowerCase() !== "procesado").length + 1;
          rcNotifyFotoPending({
            sucursal: params.sucursal,
            tipo:     params.tipo,
            periodo:  params.periodo,
            link:     up && up.link,
            fileName: params.file && params.file.name,
            total:    totalPend,
          });
        } catch (e) { /* ignore */ }
      } catch (e) {
        dispatch({ type: "TOAST/SHOW", toast: { kind: "error", title: "Error subiendo foto", body: String(e && e.message || e) } });
      } finally {
        dispatch({ type: "FOTO/JOB_END", id: jobId });
      }
    })();
  };

  const [openOpcional, setOpenOpcional] = React.useState(false);
  const optionalCount =
    (tipo ? 1 : 0) + (sucursal ? 1 : 0) + (periodo ? 1 : 0) +
    (subcat ? 1 : 0) + (consumo ? 1 : 0) + (costo ? 1 : 0) +
    (proveedor ? 1 : 0) + (notas ? 1 : 0);

  const subcatOptions = tipo
    ? getSubcatsFor(state, tipo, sucursal).map(s => ({ value: s.id, label: s.label }))
    : [];
  const providerOptions = (tipo && sucursal) ? getProviderOptionsFor(state, sucursal, tipo) : [];

  return (
    <Card>
      <div className="prt-col" style={{ gap: 18 }}>
        {/* HERO: dropzone grande con la foto */}
        <label
          className={"rc-foto-drop" + (previewUrl ? " has-image" : "")}
          htmlFor="rc-foto-file"
        >
          <input
            id="rc-foto-file"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChange}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
          />
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Vista previa" className="rc-foto-drop-img" />
              <div className="rc-foto-drop-overlay">
                <Icon name="refresh" size={18} />
                <span>Cambiar foto</span>
              </div>
            </>
          ) : (
            <div className="rc-foto-drop-empty">
              <div className="rc-foto-drop-icon"><Icon name="photo_camera" size={36} /></div>
              <div className="rc-foto-drop-title">Tomar o subir foto</div>
              <div className="rc-foto-drop-sub">Móvil: abre la cámara · Desktop: selector de archivos</div>
              <div className="rc-foto-drop-cta">
                <Icon name="cloud_upload" size={16} />
                <span>Seleccionar archivo</span>
              </div>
            </div>
          )}
        </label>
        {file && (
          <div className="rc-foto-filemeta">
            <Icon name="check_circle" size={16} />
            <span className="rc-foto-filemeta-name">{file.name}</span>
            <span className="rc-foto-filemeta-size">{Math.round(file.size / 1024)} KB</span>
          </div>
        )}

        {/* Collapsible — datos opcionales */}
        <button
          type="button"
          className={"rc-foto-collapse-head" + (openOpcional ? " open" : "")}
          onClick={() => setOpenOpcional(o => !o)}
        >
          <Icon name={openOpcional ? "expand_less" : "expand_more"} size={18} />
          <span className="rc-foto-collapse-title">
            Datos opcionales{optionalCount > 0 ? " · " + optionalCount + " completado" + (optionalCount === 1 ? "" : "s") : ""}
          </span>
          <span className="rc-foto-collapse-hint">Se pueden completar después</span>
        </button>
        {openOpcional && (
          <div className="rc-foto-collapse-body">
            <Field label="Tipo de consumo">
              <Select value={tipo} onChange={(v) => { setTipo(v); setSubcat(""); }} options={tipoOptions} placeholder="Elige tipo" />
            </Field>
            <Field label="Sucursal" helper={sucOptions.length === 0 ? "Configura sucursales para asignar." : undefined}>
              <Select value={sucursal} onChange={setSucursal} options={sucOptions} placeholder="Elige sucursal" />
            </Field>
            <Field label="Período (mes)">
              <Input type="month" value={periodo} onChange={setPeriodo} max={currentMonthISO()} />
            </Field>
            {subcatOptions.length > 0 && (
              <Field label="Subcategoría">
                <Select value={subcat} onChange={setSubcat} options={subcatOptions} placeholder="—" />
              </Field>
            )}
            <Field label="Consumo">
              <Input value={consumo} onChange={setConsumo} suffix={unidad} type="number" />
            </Field>
            {tipo === "combustible" && (
              <Field label="Unidad">
                <Select value={unidad} onChange={setUnidad} options={["L", "kg", "m³", "gal", "t", "kWh"]} placeholder="Unidad" />
              </Field>
            )}
            <Field label="Costo (CLP)">
              <Input value={costo} onChange={setCosto} type="number" />
            </Field>
            <Field label="Proveedor">
              {providerOptions.length > 0
                ? <Select value={proveedor} onChange={setProv} options={providerOptions} placeholder="Elige proveedor" />
                : <Input value={proveedor} onChange={setProv} placeholder="—" />}
            </Field>
            <Field label="Notas">
              <Input value={notas} onChange={setNotas} placeholder="Opcional" />
            </Field>
          </div>
        )}

        {error && (
          <div className="prt-help error">
            <Icon name="error" size={14} />
            <span>{error}</span>
          </div>
        )}
        <div className="rc-foto-actions">
          <Btn kind="primary" icon="cloud_upload" onClick={onSubmit} disabled={!canSubmit}>
            Subir foto
          </Btn>
        </div>
      </div>
    </Card>
  );
};

// ----- Cola (sub-componente de FotoHubView) ------------------------------
const FotoColaSection = () => {
  const { state, dispatch } = useApp();
  const go = (view, extra) => dispatch({ type: "NAVIGATE", view, ...extra });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      dispatch({ type: "FOTO/LOAD_START" });
      try {
        const rows = await rcReadFotos();
        if (!cancelled) dispatch({ type: "FOTO/LOAD_OK", rows });
      } catch (e) {
        if (!cancelled) dispatch({ type: "FOTO/LOAD_FAIL", error: String(e && e.message || e) });
      }
    })();
    return () => { cancelled = true; };
  }, [state.fotos.invalidatedAt]);

  const rows = state.fotos.rows || [];
  const pendientes = rows.filter(r => (r.status || "").toLowerCase() !== "procesado");
  const procesados = rows.filter(r => (r.status || "").toLowerCase() === "procesado");

  const tipoLabel = { electricidad: "Electricidad", combustible: "Combustible", agua: "Agua", refrigerantes: "Refrigerantes" };

  const renderRow = (r) => (
    <div key={r.rowIndex} className="rc-foto-row">
      <span className="rc-foto-row-ico" style={{ background: "var(--rl-gray-100)", color: "var(--rl-gray-700)" }}>
        <Icon name={TYPES[r.tipo]?.icon || "photo_camera"} size={16} />
      </span>
      <div className="rc-foto-row-body">
        <div className="rc-foto-row-title">
          {r.sucursal || "—"} {r.tipo && <span style={{ color: "var(--rl-gray-600)" }}> · {tipoLabel[r.tipo] || r.tipo}</span>}
        </div>
        <div className="rc-foto-row-sub">
          {r.periodo || "—"} · {r.fechaSubida ? fmtDateTime(r.fechaSubida) : "—"}
          {r.link && (<> · <a href={r.link} target="_blank" rel="noopener" className="prt-link">Foto</a></>)}
        </div>
      </div>
      <div className="rc-foto-row-actions">
        <Chip size="sm" kind={r.status === "procesado" ? "success" : "warning"}>
          {r.status === "procesado" ? "Procesado" : "Pendiente"}
        </Chip>
        {r.status !== "procesado" && (
          <Btn size="sm" icon="edit" onClick={() => go("foto-complete", { fotoCompleteRow: r.rowIndex })}>
            Completar
          </Btn>
        )}
      </div>
    </div>
  );

  if (state.fotos.loading && rows.length === 0) {
    return <Card><div className="prt-muted">Cargando cola…</div></Card>;
  }
  if (state.fotos.error) {
    return <Card><div className="prt-help error"><Icon name="error" size={14} /><span>{state.fotos.error}</span></div></Card>;
  }

  const inflightJobs = state.fotos.inflightJobs || [];
  const inflightUploads = inflightJobs.filter(j => j.kind === "upload");

  return (
    <>
      <Card flush>
        <div className="rc-home-card-head">
          <div>
            <div className="rc-home-kpi">{pendientes.length + inflightUploads.length}</div>
            <div className="prt-hint" style={{ marginTop: 2 }}>
              pendientes{inflightUploads.length > 0 ? " · " + inflightUploads.length + " subiendo" : ""}
            </div>
          </div>
        </div>
        <div className="rc-home-list">
          {inflightUploads.map(j => (
            <div key={j.id} className="rc-foto-row rc-foto-row-ghost">
              <span className="rc-foto-row-ico" style={{ background: "var(--rl-primary-50)", color: "var(--rl-primary-900)" }}>
                <span className="prt-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              </span>
              <div className="rc-foto-row-body">
                <div className="rc-foto-row-title">Subiendo foto…</div>
                <div className="rc-foto-row-sub">{j.label}</div>
              </div>
              <div className="rc-foto-row-actions">
                <Chip size="sm" kind="info">En curso</Chip>
              </div>
            </div>
          ))}
          {pendientes.length === 0 && inflightUploads.length === 0
            ? <div className="rc-home-empty"><Icon name="check_circle" size={28} style={{ color: "var(--rl-success-500)" }} /><div className="prt-hint" style={{ marginTop: 6 }}>Sin fotos pendientes.</div></div>
            : pendientes.map(renderRow)}
        </div>
      </Card>
      <div style={{ height: 14 }} />
      <Card flush>
        <div className="rc-home-card-head">
          <div>
            <div className="rc-home-kpi">{procesados.length}</div>
            <div className="prt-hint" style={{ marginTop: 2 }}>procesadas</div>
          </div>
        </div>
        <div className="rc-home-list">
          {procesados.length === 0
            ? <div className="rc-home-empty"><Icon name="inbox" size={28} style={{ color: "var(--rl-gray-300)" }} /><div className="prt-hint" style={{ marginTop: 6 }}>Aún no hay fotos procesadas.</div></div>
            : procesados.slice(0, 20).map(renderRow)}
        </div>
      </Card>
    </>
  );
};

// ----- Hub (Nueva | Cola) ------------------------------------------------
const FotoHubView = () => {
  const { state } = useApp();
  const [tab, setTab] = React.useState("nueva"); // nueva | cola

  const onUploaded = () => setTab("cola");

  const rows = state.fotos.rows || [];
  const pendCount = rows.filter(r => (r.status || "").toLowerCase() !== "procesado").length;
  const inflightJobs = state.fotos.inflightJobs || [];

  return (
    <div>
      <SectionHead
        eyebrow="Tomar foto"
        title="Foto + datos diferidos"
        sub="Captura una foto del medidor o documento. Los datos se pueden completar después, aquí mismo o directo en el Sheet."
      />
      <div className="rc-foto-tabs">
        <button
          className={"rc-foto-tab" + (tab === "nueva" ? " active" : "")}
          onClick={() => setTab("nueva")}
        >
          <Icon name="photo_camera" size={16} />
          <span>Nueva</span>
        </button>
        <button
          className={"rc-foto-tab" + (tab === "cola" ? " active" : "")}
          onClick={() => setTab("cola")}
        >
          <Icon name="list" size={16} />
          <span>Cola{pendCount > 0 ? " · " + pendCount : ""}</span>
        </button>
      </div>

      {inflightJobs.length > 0 && (
        <div className="rc-foto-inflight">
          <span className="prt-spinner" />
          <span className="rc-foto-inflight-label">
            {inflightJobs.length === 1
              ? inflightJobs[0].label + "…"
              : inflightJobs.length + " procesos en segundo plano…"}
          </span>
          <span className="rc-foto-inflight-hint">Puedes seguir usando la app.</span>
        </div>
      )}

      {tab === "nueva"
        ? <FotoCaptureForm onUploaded={onUploaded} />
        : <FotoColaSection />}
    </div>
  );
};

// ----- Completar datos de una foto pendiente -----------------------------
const FotoCompleteView = () => {
  const { state, dispatch } = useApp();
  const go = (view) => dispatch({ type: "NAVIGATE", view });

  const rowIndex = state.fotoCompleteRow;
  const row = (state.fotos.rows || []).find(r => r.rowIndex === rowIndex);

  const [consumo, setConsumo]   = React.useState("");
  const [unidad, setUnidad]     = React.useState("");
  const [costo, setCosto]       = React.useState("");
  const [proveedor, setProv]    = React.useState("");
  const [subcat, setSubcat]     = React.useState("");
  const [notas, setNotas]       = React.useState("");
  const [tipo, setTipo]         = React.useState("");
  const [sucursal, setSucursal] = React.useState("");
  const [periodo, setPeriodo]   = React.useState("");
  const [error, setError]       = React.useState("");

  React.useEffect(() => {
    if (!row) return;
    setConsumo(row.consumo || "");
    setUnidad(row.unidad || (TYPES[row.tipo]?.unit || ""));
    setCosto(row.costo || "");
    setProv(row.proveedor || "");
    setSubcat(row.subcat || "");
    setNotas(row.notas || "");
    setTipo(row.tipo || "");
    setSucursal(row.sucursal || "");
    setPeriodo(row.periodo || "");
  }, [row?.rowIndex]);

  if (!row) {
    return (
      <div>
        <SectionHead eyebrow="Completar" title="Foto no encontrada" />
        <Btn onClick={() => go("foto-hub")}>Volver a la cola</Btn>
      </div>
    );
  }

  const sucursales = (state.configSucursales || []).filter(s => s.activa);
  const sucOptions = sucursales.map(s => ({ value: s.nombre, label: s.nombre }));
  const tipoOptions = [
    { value: "electricidad", label: "Electricidad" },
    { value: "combustible",  label: "Combustible" },
    { value: "agua",         label: "Agua" },
    { value: "refrigerantes",label: "Refrigerantes" },
  ];
  const subcatOptions = tipo
    ? getSubcatsFor(state, tipo, sucursal).map(s => ({ value: s.id, label: s.label }))
    : [];
  const providerOptions = (tipo && sucursal) ? getProviderOptionsFor(state, sucursal, tipo) : [];

  // Procesa en background: navegamos de vuelta a la cola al instante,
  // las llamadas a Apps Script (update × N + append + move + refresh) corren
  // sin bloquear la UI.
  const onSave = () => {
    if (!consumo) { setError("Consumo es obligatorio."); return; }
    setError("");
    const params = {
      fileId: row.fileId,
      rowIndex: row.rowIndex,
      patch: { consumo, unidad, costo, proveedor, subcat, notas },
      fotoRow: { ...row, tipo, sucursal, periodo },
    };
    const label = "Procesando foto · fila " + row.rowIndex;
    const jobId = newJobId();
    // 1) Volvemos a la cola enseguida.
    go("foto-hub");
    // 2) Marca el job + toast inicial.
    dispatch({ type: "FOTO/JOB_START", job: { id: jobId, kind: "complete", label } });
    dispatch({ type: "TOAST/SHOW", toast: { kind: "info", title: "Procesando foto…", body: "Guardando datos y moviendo archivo." } });
    // 3) fire-and-forget.
    (async () => {
      try {
        await rcCompleteFoto(params);
        dispatch({ type: "FOTO/INVALIDATE" });
        dispatch({ type: "TOAST/SHOW", toast: { kind: "success", title: "Foto procesada", body: "Datos guardados y reflejados en el dashboard." } });
      } catch (e) {
        dispatch({ type: "TOAST/SHOW", toast: { kind: "error", title: "Error procesando foto", body: String(e && e.message || e) } });
      } finally {
        dispatch({ type: "FOTO/JOB_END", id: jobId });
      }
    })();
  };

  return (
    <div>
      <SectionHead
        eyebrow="Completar foto"
        title={(sucursal || row.sucursal || "Foto pendiente") + (tipo ? " · " + (TYPES[tipo]?.label || tipo) : "")}
        sub={"Período " + (periodo || "—") + ". Al guardar se mueve el archivo a Procesados y se copia el registro al dashboard."}
      />
      <div className="rc-foto-complete">
        <div className="rc-foto-complete-img">
          {row.fileId ? (
            <a href={row.link} target="_blank" rel="noopener">
              <img
                src={"https://drive.google.com/thumbnail?id=" + row.fileId + "&sz=w800"}
                alt="Foto"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </a>
          ) : (
            <div className="prt-muted">Sin URL de Drive disponible.</div>
          )}
          {row.link && <a className="prt-link" href={row.link} target="_blank" rel="noopener" style={{ marginTop: 8, display: "inline-block" }}>Abrir en Drive →</a>}
        </div>
        <Card style={{ flex: 1, minWidth: 0 }}>
          <div className="prt-col" style={{ gap: 14 }}>
            <Field label="Tipo de consumo">
              <Select value={tipo} onChange={(v) => { setTipo(v); setSubcat(""); }} options={tipoOptions} placeholder="Elige tipo" />
            </Field>
            <Field label="Sucursal">
              <Select value={sucursal} onChange={setSucursal} options={sucOptions} placeholder="Elige sucursal" />
            </Field>
            <Field label="Período (mes)">
              <Input type="month" value={periodo} onChange={setPeriodo} max={currentMonthISO()} />
            </Field>
            {subcatOptions.length > 0 && (
              <Field label="Subcategoría">
                <Select value={subcat} onChange={setSubcat} options={subcatOptions} placeholder="—" />
              </Field>
            )}
            <Field label="Consumo" required>
              <Input value={consumo} onChange={setConsumo} suffix={unidad} type="number" />
            </Field>
            {tipo === "combustible" && (
              <Field label="Unidad">
                <Select value={unidad} onChange={setUnidad} options={["L", "kg", "m³", "gal", "t", "kWh"]} placeholder="Unidad" />
              </Field>
            )}
            <Field label="Costo (CLP)">
              <Input value={costo} onChange={setCosto} type="number" />
            </Field>
            <Field label="Proveedor">
              {providerOptions.length > 0
                ? <Select value={proveedor} onChange={setProv} options={providerOptions} placeholder="Elige proveedor" />
                : <Input value={proveedor} onChange={setProv} placeholder="—" />}
            </Field>
            <Field label="Notas">
              <Input value={notas} onChange={setNotas} placeholder="Opcional" />
            </Field>
            {error && <div className="prt-help error"><Icon name="error" size={14} /><span>{error}</span></div>}
            <div className="prt-row" style={{ gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              <Btn kind="primary" icon="check" onClick={onSave} disabled={!consumo}>
                Guardar y procesar
              </Btn>
              <Btn onClick={() => go("foto-hub")}>Cancelar</Btn>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

Object.assign(window, { FotoHubView, FotoCompleteView });
