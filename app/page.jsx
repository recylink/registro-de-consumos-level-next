import Link from "next/link";
import { Icon } from "@/components/icons";
import { AvisoDatos } from "@/components/ui/avisos";
import { Card, Chip, SectionHead } from "@/components/ui/layout";
import { loadRecords, loadSucursales } from "@/lib/data";
import { TYPES } from "@/lib/domain/catalog";
import { estadoCarga } from "@/lib/domain/estado-carga";
import { fmtMonth, fmtNum, monthLabelShort } from "@/lib/domain/format";
import { currentMonthKey } from "@/lib/domain/periods";

// Inicio. Portado de proto/landing.jsx. Es todo lectura, así que queda como
// componente de servidor: no manda JavaScript propio al navegador y los dos
// paneles se arman con los datos ya cargados. Los botones que despachaban
// NAVIGATE son links.

export default async function InicioPage() {
  const [records, sucursales] = await Promise.all([loadRecords(), loadSucursales()]);
  const mes = currentMonthKey();

  const delMes = records.data.filter(
    (r) => r.estado !== "eliminada" && String(r.date).startsWith(mes),
  );
  const recientes = [...delMes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const carga = estadoCarga(sucursales.data, records.data, mes);

  const mesLbl = monthLabelShort(mes).replace(/\b(\w)/, (c) => c.toUpperCase());

  return (
    <div>
      <AvisoDatos configured={records.configured} error={records.error || sucursales.error} />
      <SectionHead eyebrow={`Período ${mesLbl}`} title="¡Hola! Esto es lo que pasa hoy" />

      <div className="rc-home-grid">
        {/* Registros del mes */}
        <Card flush>
          <div className="rc-home-card-head">
            <div>
              <div className="rc-home-kpi">{delMes.length}</div>
              <div className="prt-hint" style={{ marginTop: 2 }}>registros este mes</div>
            </div>
            <Link className="rc-home-link" href="/dashboard">
              Ver dashboard <Icon name="arrow_forward" size={14} />
            </Link>
          </div>
          <div className="rc-home-list">
            {recientes.length === 0 ? (
              <div className="rc-home-empty">
                <Icon name="inbox" size={28} style={{ color: "var(--rl-gray-300)" }} />
                <div className="prt-hint" style={{ marginTop: 6 }}>Aún no hay registros este mes.</div>
              </div>
            ) : (
              recientes.map((r) => {
                const t = TYPES[r.type];
                return (
                  <div key={r.id} className="rc-home-item">
                    <span className="rc-home-item-ico" style={{ background: t?.bg, color: t?.color }}>
                      <Icon name={t?.icon || "inbox"} size={16} />
                    </span>
                    <div className="rc-home-item-body">
                      <div className="rc-home-item-title">
                        {r.sucursal} · <span style={{ color: "var(--rl-gray-600)" }}>{t?.label || r.type}</span>
                      </div>
                      <div className="rc-home-item-sub">
                        {r.provider || "—"} · {fmtNum(r.cantidad)} {r.unit}
                      </div>
                    </div>
                    <div className="rc-home-item-time">{fmtMonth(r.date)}</div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Estado de carga por sucursal */}
        <Card flush>
          <div className="rc-home-card-head">
            <div>
              <div className="rc-home-kpi">
                {carga.alDia}/{carga.total}
              </div>
              <div className="prt-hint" style={{ marginTop: 2 }}>
                {carga.pendientes === 0
                  ? "todas al día"
                  : `${carga.pendientes} sucursal${carga.pendientes !== 1 ? "es" : ""} con pendientes`}
              </div>
            </div>
            <Link className="rc-home-link" href="/matriz">
              Ver matriz <Icon name="arrow_forward" size={14} />
            </Link>
          </div>
          <div className="rc-home-list">
            {carga.items.length === 0 ? (
              <div className="rc-home-empty">
                <Icon name="apartment" size={28} style={{ color: "var(--rl-gray-300)" }} />
                <div className="prt-hint" style={{ marginTop: 6, marginBottom: 8 }}>
                  Aún no hay sucursales configuradas.
                </div>
                <Link className="prt-btn primary sm" href="/configuracion/nueva">
                  <Icon name="add" />
                  Agregar sucursal
                </Link>
              </div>
            ) : (
              carga.items.map(({ suc, badge }) => (
                <Link key={suc.id} className="rc-home-suc" href="/matriz">
                  <span className="rc-home-suc-dot" style={{ background: badge.dot }} />
                  <span className="rc-home-suc-name">{suc.nombre}</span>
                  <Chip size="sm">{badge.label}</Chip>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="rc-home-cta">
        <div>
          <div className="rc-home-cta-title">¿Listo para registrar un consumo?</div>
          <div className="rc-home-cta-sub">Elige el modo según el insumo que vas a cargar.</div>
        </div>
        <div className="rc-home-cta-actions">
          <Link className="prt-btn" href="/registrar/manual">
            <Icon name="edit" />
            Registrar a mano
          </Link>
          <Link className="prt-btn primary" href="/registrar/subir">
            <Icon name="cloud_upload" />
            Subir documento
          </Link>
        </div>
      </div>
    </div>
  );
}
