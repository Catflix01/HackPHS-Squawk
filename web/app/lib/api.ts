export const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";

export async function fetchFallback<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${serverBaseUrl}${path}`);
    if (!response.ok) throw new Error("request failed");
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function postFallback<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${serverBaseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("request failed");
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}
