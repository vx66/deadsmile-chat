import { db, getUserBySession, uploads } from "../../../lib/chat-store";

export const dynamic = "force-dynamic";

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export async function POST(request: Request) {
  try {
    const user = await getUserBySession(request);
    if (!user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind") === "avatar" ? "avatar" : "chat";
    if (!(file instanceof File)) {
      return Response.json({ error: "Selecciona una imagen." }, { status: 400 });
    }
    const extension = allowedTypes.get(file.type);
    if (!extension) {
      return Response.json({ error: "Formato no permitido. Usa JPG, PNG, WEBP o GIF." }, { status: 415 });
    }
    if (file.size > 6 * 1024 * 1024) {
      return Response.json({ error: "La imagen supera el límite de 6 MB." }, { status: 413 });
    }
    const key = `uploads/${user.id}/${kind}/${crypto.randomUUID()}.${extension}`;
    await uploads().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    const url = `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
    if (kind === "avatar") {
      await db().prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(url, user.id).run();
    }
    return Response.json({ url }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo subir la imagen." }, { status: 500 });
  }
}
