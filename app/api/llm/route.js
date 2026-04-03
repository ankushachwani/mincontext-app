export const runtime = "edge";

export async function POST(req) {
  // User-provided key takes priority — each user burns their own quota.
  // Falls back to server key for anonymous users.
  const userKey = req.headers.get("x-groq-key");
  const key = userKey || process.env.GROQ_API_KEY;

  if (!key) {
    return Response.json(
      { error: "No API key configured. Add your free Groq key via the key icon." },
      { status: 500 }
    );
  }

  const body = await req.json();

  // User-provided key → use the smarter 70b model (their own quota, no cost to us).
  // Server fallback key → use 8b-instant (500k TPD free tier, conserves shared quota).
  const model = userKey ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, temperature: 0.1, ...body }),
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}
