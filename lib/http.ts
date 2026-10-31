/** Κοινές απαντήσεις των endpoints: `{ error: { code, message, details? } }` με ελληνικό μήνυμα. */
export function fail(status: number, code: string, message: string, details?: unknown) {
  return Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status, headers: { "Cache-Control": "no-store" } });
}

export const ok = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Η IP του καλούντος πίσω από τον proxy του Coolify (Traefik): η πρώτη τιμή του X-Forwarded-For. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
