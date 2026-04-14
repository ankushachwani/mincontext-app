import { kv } from "@vercel/kv";

const TTL = 60 * 60 * 24 * 7; // 7 days

function normalizeKey(raw) {
  return "mc:" + raw.toLowerCase().trim();
}

export async function GET(req) {
  try {
    const key = normalizeKey(new URL(req.url).searchParams.get("k") || "");
    if (key === "mc:") return Response.json(null, { status: 400 });
    const data = await kv.get(key);
    if (!data) {
      console.log("[cache] miss", { key });
      return Response.json(null, { status: 404 });
    }
    console.log("[cache] hit", { key });
    return Response.json(data);
  } catch {
    return Response.json(null, { status: 404 });
  }
}

export async function POST(req) {
  try {
    const { key, files } = await req.json();
    if (!key || !Array.isArray(files)) return Response.json({ ok: false }, { status: 400 });
    await kv.set(normalizeKey(key), { files, ts: Date.now() }, { ex: TTL });
    console.log("[cache] stored", { key: normalizeKey(key), files: files.length });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: true });
  }
}
