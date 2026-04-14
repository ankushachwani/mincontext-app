export const runtime = "edge";

const MODEL = "llama-3.3-70b-versatile";

export async function POST(req) {
  const t0 = Date.now();
  const key = req.headers.get("x-groq-key");

  if (!key) {
    return Response.json(
      { error: "No API key provided." },
      { status: 401 }
    );
  }

  const body = await req.json();

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: MODEL, temperature: 0, ...body }),
  });

  const data = await res.json();
  const ms = Date.now() - t0;

  if (!res.ok) {
    console.error("[llm] error", { status: res.status, ms, error: data.error?.message });
  } else {
    console.log("[llm] ok", { ms });
  }

  return Response.json(data, { status: res.status });
}
