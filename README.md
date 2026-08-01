# Dead Smile Chat

Chat web estilo IRC/cyberpunk con canal público `#deadchat`, mensajes privados, imágenes, emojis, avatares, cuentas locales, invitados y consola administrativa.

## Desarrollo local

Requiere Node.js 22.13 o superior.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

## Producción con Dokploy

El repositorio incluye `Dockerfile`, `docker-compose.yml`, healthcheck y persistencia para SQLite e imágenes. Consulta [DOKPLOY.md](./DOKPLOY.md) para configurar el repositorio, el dominio, `ADMIN_PASSWORD` y las copias de seguridad.

## Verificación

```powershell
npm test
```
