# Dead Smile Chat en Dokploy

El proyecto se despliega como un servicio **Docker Compose** de una sola réplica. El volumen `dead_smile_data`, montado en `/app/data`, conserva la base de datos SQLite, sesiones, bloqueos, mensajes e imágenes entre reinicios y despliegues.

## Configuración en Dokploy

1. Crea un proyecto y agrega un servicio de tipo **Docker Compose**.
2. Conecta el repositorio `VX66/dead-smile-chat` y selecciona la rama `main`.
3. Usa `./docker-compose.yml` como **Compose Path**.
4. En **Environment**, define `ADMIN_PASSWORD` con una contraseña larga y única.
5. Despliega el servicio.
6. En **Domains**, agrega tu dominio al servicio `dead-smile-chat` usando el puerto `3000` y activa HTTPS.
7. En **Volume Backups**, programa copias de seguridad del volumen `dead_smile_data`.

## Consideraciones

- Mantén **una sola réplica** porque la base de datos persistente es SQLite/D1 local.
- No elimines el volumen `dead_smile_data` al redeplegar.
- La ruta de salud es `/api/health`; responde `200` cuando la base de datos está disponible.
- Dokploy/Traefik debe enviar `X-Forwarded-For` y `X-Forwarded-Proto`. La app usa esos encabezados para registrar la IP real y emitir cookies seguras detrás de HTTPS.
- La geolocalización detallada requiere poner el dominio detrás de Cloudflare o agregar posteriormente un proveedor GeoIP. Sin ese servicio, la IP seguirá registrándose, pero algunos campos de ubicación pueden quedar vacíos.
