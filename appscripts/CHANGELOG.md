# Apps Script — CHANGELOG (NEXT)

Snapshots congelados del `apps-script.gs` desplegado. `SCRIPT_VERSION` en el
código = versión activa (verificable con `?action=ping`).

| Versión | Fecha | Cambios |
|---------|-------|---------|
| v1 | 2026-07-01 | Base inicial: concurrencia (withLock), upsertSucursal/deleteSucursal, SCRIPT_VERSION en ping |
| v2 | 2026-07-13 | Módulo Medidores: hojas Medidores/Lecturas Medidor/Precios Medidor (getSheetRows/setSheetRows + acciones get/set), uploadFile con subfolders, deleteFile (papelera Drive) |
| v3 | 2026-07-17 | Columna "Facturable" en hoja Medidores (medidores excluidos del proceso de facturación) |
| v5 | 2026-08-05 | **Recorte de la superficie expuesta.** El script pasa de atender 26 actions a 6: `ping`, `setup`, `upload`, `move`, `deleteFile`, `notifyFotoPending`. Se retiran las 8 lecturas y todas las escrituras a Sheets, que ya sirve el SDK — incluidas `setSheetRows` × 3 y `setEmissions`, que borraban y reescribían hojas completas. `doGet` sin `action` ya no hace `read` por defecto: un GET pelado a la URL devolvía la planilla entera. Lista blanca en `ACTIONS_ACTIVAS`; lo retirado responde con un mensaje que dice dónde vive ahora. Las funciones de Sheets NO se borraron (`setup` depende de varias y el grafo no se puede verificar sin correr el script), pero ya no son alcanzables por HTTP |
| v4 | 2026-07-28 | Instancia NEXT (Next.js + Vercel): `SPREADSHEET_ID` vacío → opera sobre la planilla contenedora vía `rcSpreadsheet()`; acción `setup` que crea el árbol de Drive bajo una carpeta raíz y guarda los IDs en la clave `driveFolders` de la hoja Config; acción `updateCells` (varias celdas en un request, completar foto pasa de 11 llamadas a 1); se elimina `WEB_CFG.FOLDERS`, que era código muerto con IDs de otra instancia |
