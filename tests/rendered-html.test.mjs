import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the Dead Smile product shell", async () => {
  const [client, layout] = await Promise.all([
    readFile(new URL("../app/ChatApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);
  assert.match(client, /DEAD SMILE/);
  assert.match(client, /ENTRAR A #DEADCHAT/);
  assert.match(client, /aria-label="Responder"/);
  assert.match(client, /akiba-marquee/);
  assert.match(client, /direct-channel/);
  assert.match(client, /channel-tabs/);
  assert.match(client, /direct-inbox-menu/);
  assert.match(client, /closeDirectTab/);
  assert.match(client, /NUEVO PRIVADO/);
  assert.match(client, /directLatestMessageRef/);
  assert.match(client, /document\.title/);
  assert.match(client, /publicUnread \+ totalDirectUnread/);
  assert.match(client, /`\(\$\{totalUnread\}\)/);
  assert.match(client, /openDirectChannel/);
  assert.match(client, /editOwnMessage/);
  assert.match(client, /edit-message-modal/);
  assert.doesNotMatch(client, /window\.prompt/);
  assert.match(client, /EmojiPicker/);
  assert.match(client, /EmojiStyle\.NATIVE/);
  assert.match(client, /searchPlaceholder="Buscar emoji\.\.\."/);
  assert.doesNotMatch(client, /const emojiSet/);
  assert.match(client, /terminal-login/);
  assert.match(client, /Registrar identidad/);
  assert.match(client, /joinRegistered/);
  assert.doesNotMatch(client, /signin-with-chatgpt/);
  assert.match(client, /dead-smile-login-glitch\.png/);
  await access(new URL("../public/dead-smile-login-glitch.png", import.meta.url));
  assert.match(client, /se ha conectado|irc-system-event/);
  assert.match(client, /Dashboard de/);
  assert.match(client, /ELIMINAR TODO EL CHAT/);
  assert.match(client, /toggle_pin/);
  assert.match(client, /xergno/);
  assert.doesNotMatch(client, /CANALES DE VOZ|serverNodes|voice-channel/);
  assert.match(layout, /og-deadchat\.png/);
  assert.doesNotMatch(`${client}${layout}`, /codex-preview|react-loading-skeleton/i);
});

test("keeps the login and chat usable on mobile viewports", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.irc-gateway\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /\.terminal-login-visual\s*\{\s*height:\s*clamp\(130px,\s*24dvh,\s*175px\);/);
  assert.match(css, /\.irc-people\s*\{\s*position:\s*fixed;[\s\S]*?bottom:\s*calc\(27px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /\.irc-composer textarea,\s*\.edit-textarea-shell textarea\s*\{\s*font-size:\s*16px;/);
});

test("includes searchable Japanese kaomojis in both chat composers", async () => {
  const [client, css] = await Promise.all([
    readFile(new URL("../app/ChatApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(client, /const KAOMOJI_GROUPS/);
  assert.match(client, /KAOMOJI 顔文字/);
  assert.match(client, /Buscar categoría o kaomoji/);
  assert.match(client, /name: "ANIMALES"/);
  assert.match(client, /onSelect\(`\$\{item\} `/);
  assert.match(css, /\.kaomoji-picker/);
  assert.match(css, /\.kaomoji-groups button/);
});

test("ships the product metadata and social card", async () => {
  const [layout] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../public/og-deadchat.png", import.meta.url)),
  ]);
  assert.match(layout, /Dead Smile Chat — Signal Never Dies/);
  assert.match(layout, /summary_large_image/);
});

test("enforces replies and author-only message editing", async () => {
  const route = await readFile(new URL("../app/api/messages/route.ts", import.meta.url), "utf8");
  assert.match(route, /reply_to_id/);
  assert.match(route, /Solo puedes editar tus propios mensajes/);
  assert.match(route, /target\.user_id !== user\.id/);
  assert.doesNotMatch(route, /export async function DELETE/);
});

test("keeps private channels restricted to their participants", async () => {
  const route = await readFile(new URL("../app/api/direct-messages/route.ts", import.meta.url), "utf8");
  assert.match(route, /d\.sender_id = \? AND d\.recipient_id = \?/);
  assert.match(route, /target\.sender_id !== user\.id/);
  assert.match(route, /recipientId === user\.id/);
  assert.match(route, /read_at IS NULL/);
  assert.match(route, /action === "mark_read"/);
  assert.match(route, /conversations/);
  assert.match(route, /ipTag\(participant\.ip_hash\)/);
  assert.doesNotMatch(route, /u\.ip_tag|status, ip_tag/);
  assert.doesNotMatch(route, /export async function DELETE/);
});

test("ships a persistent Dokploy deployment", async () => {
  const [dockerfile, compose, health, store, envExample] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/chat-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(compose, /dead_smile_data:\/app\/data/);
  assert.match(dockerfile, /DATA_DIR=\/app\/data/);
  assert.match(dockerfile, /dist\/standalone\/server\.js/);
  assert.match(compose, /ADMIN_PASSWORD/);
  assert.match(health, /SELECT 1 AS ok/);
  assert.match(store, /x-forwarded-proto/);
  assert.match(store, /process\.env\.ADMIN_PASSWORD/);
  assert.match(health, /assertRuntimeConfiguration/);
  assert.match(envExample, /ADMIN_PASSWORD=/);
});

test("uses local registered accounts on Dokploy", async () => {
  const [route, store] = await Promise.all([
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/chat-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /action\?: "signup" \| "login"/);
  assert.match(route, /createPasswordHash/);
  assert.match(route, /verifyPassword/);
  assert.doesNotMatch(route, /getChatGPTUser/);
  assert.match(store, /scrypt/);
  assert.match(store, /timingSafeEqual/);
});
