import { uploads } from "../../../../lib/chat-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  try {
    const { key } = await context.params;
    const object = await uploads().get(key.join("/"));
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers({ "Cache-Control": "public, max-age=31536000, immutable" });
    object.writeHttpMetadata(headers);
    if (!headers.has("Content-Type") && object.httpMetadata?.contentType) {
      headers.set("Content-Type", object.httpMetadata.contentType);
    }
    return new Response(object.body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
