import { AvisoDatos } from "@/components/ui/avisos";
import { ConfigLista } from "@/components/views/config-lista";
import { NotifEmails } from "@/components/views/notif-emails";
import { loadFotoNotifEmails, loadRecords, loadSucursales } from "@/lib/data";

export const metadata = { title: "Sucursales" };

export default async function ConfiguracionPage() {
  const [sucursales, records, emails] = await Promise.all([
    loadSucursales(),
    loadRecords(),
    loadFotoNotifEmails(),
  ]);

  // Cuántos registros históricos tiene cada sucursal: el diálogo de borrado lo
  // usa para advertir que la historia sobrevive a la configuración.
  const registrosPorSucursal = {};
  for (const r of records.data) {
    registrosPorSucursal[r.sucursal] = (registrosPorSucursal[r.sucursal] || 0) + 1;
  }

  return (
    <div>
      <AvisoDatos configured={sucursales.configured} error={sucursales.error} />
      <ConfigLista sucursales={sucursales.data} registrosPorSucursal={registrosPorSucursal} />
      <NotifEmails emails={emails.data} />
    </div>
  );
}
