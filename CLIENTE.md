# Instancia: Level

Espejo de esta app para el cliente **Level**. Reemplaza a la versión Apps Script que
corre en `registro-de-consumos-level` (repo `domrecylink/registro-de-consumos-level`,
publicado en GitHub Pages).

Archivo aparte del README a propósito: así traer cambios de la instancia de referencia
(`git fetch upstream && git merge upstream/main`) no choca con lo que es propio de Level.

## A qué apunta

| Qué | Dónde |
|---|---|
| Planilla | `1ERuuOcBr6cLdRrrlOxraR-KJLWj1zzVgxEsMROkh5Qo` — "Registro de Consumos  Level" |
| Carpeta raíz de Drive | `1B9VwKbFxNOR2Uj9GDrHszfT9y_99IYA4` — "Level", **en la unidad compartida `0ADgVGuZngcHNUk9PVA`** |
| Carpeta vieja, del prototipo | `1Avt9D-qrIV4rkshF_HZI9X8QEQQuDSDV` — en Mi unidad de Domingo. Ahí siguen la planilla y 1 PDF |
| Robot (service account) | `rcando@recylink.iam.gserviceaccount.com`, el mismo que NEXT |
| Columna "Empresa" | `Level` (`lib/instance.js`) |

## Lo único que cambia respecto de la instancia de referencia

`EMPRESA` en `lib/instance.js`. Todo lo demás son variables de entorno. Si aparece un
segundo cambio de código propio de Level, anotarlo acá: es lo que habrá que rehacer en
cada cliente nuevo.

## Estado de la puesta en marcha

- [x] Planilla compartida con el robot como **Editor** (2026-08-31; verificado: 13 hojas,
      0 encabezados desalineados, dashboard renderiza Lira 320 y Lira 254)
- [x] Carpeta raíz en una **unidad compartida**, con el robot como `fileOrganizer`
      (2026-08-31). Es una carpeta NUEVA y vacía, no la del prototipo
- [x] `POST /api/migracion/setup` corrido limpio: 27 carpetas, todos los `antes` en
      `null`, no pisó nada (2026-08-31)
- [x] Subir / mover / borrar en Drive verificado de punta a punta con
      `/api/diagnostico/drive`, sin dejar archivos de prueba (2026-08-31)
- [ ] Desplegado en Vercel con `SITE_PASSWORD`
- [ ] Apps Script viejo apagado
- [ ] Mover la planilla y el PDF viejo a la carpeta nueva — **recién después de apagar
      el viejo**: la planilla tiene el Apps Script del prototipo adentro, y moverla a una
      unidad compartida le cambia el dueño

## Ojo

Mientras el prototipo viejo siga vivo sobre esta misma planilla, **las dos apps se pisan**:
el `.gs` v6 todavía tiene `setMedidores` / `setLecturasMedidor` / `setPreciosMedidor`, que
borran la hoja y la reescriben entera. Puede barrer lo que guardó esta app sin dar error.

Las 8 carpetas planas que hay hoy bajo "Level" (`Fotos por completar`, `Medidores - Pagos`,
…) las creó el prototipo y tienen nombres que esta app no conoce. `setup` crea su propio
árbol al lado; el contenido viejo se mueve a mano.
