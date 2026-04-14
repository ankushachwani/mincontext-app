export const runtime = "edge";

export async function POST(req) {
  const t0 = Date.now();
  const userKey = req.headers.get("x-groq-key");
  const key = userKey || process.env.GROQ_API_KEY;

  if (!key) {
    console.error("[llm] no_key");
    return Response.json(
      { error: "No API key configured. Add your free Groq key via the key icon." },
      { status: 500 }
    );
  }

  const body = await req.json();
  const model = userKey ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, temperature: 0, ...body }),
  });

  const data = await res.json();
  const ms = Date.now() - t0;

  if (!res.ok) {
    console.error("[llm] error", { status: res.status, model, ms, error: data.error?.message });
  } else {
    console.log("[llm] ok", { model, ms, key_type: userKey ? "user" : "shared" });
  }

  return Response.json(data, { status: res.status });
}
