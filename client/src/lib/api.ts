// Thin client for the BingoASM REST API.
// Every response is {success, data} or {success:false, message}; this unwraps data or throws ApiError.
// Tokens live in sessionStorage (closing the browser signs out) and go out as `Authorization: Bearer`.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const TOKEN_KEY = "bingoasm.tokens";
export const AUTH_EXPIRED_EVENT = "bingoasm:auth-expired";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const tokens = {
  get(): Tokens | null {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  set(t: Tokens) {
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken }));
    } catch {
      /* private mode: stay signed in for this page only */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  /** Return the raw Response (file downloads). */
  raw?: boolean;
}

function url(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return API_BASE + path + (s ? "?" + s : "");
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time; concurrent 401s wait for the same attempt. */
function refresh(): Promise<boolean> {
  const t = tokens.get();
  if (!t?.refreshToken) return Promise.resolve(false);
  refreshing ??= fetch(url("/api/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: t.refreshToken }),
  })
    .then(async (res) => {
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return false;
      tokens.set(json.data);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send(method: string, path: string, opts: RequestOptions, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  const t = tokens.get();
  if (t) headers.Authorization = "Bearer " + t.accessToken;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url(path, opts.query), { method, headers, body });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (res.status === 401 && t && !retried && !path.startsWith("/api/auth/login")) {
    if (await refresh()) return send(method, path, opts, true);
    tokens.clear();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return res;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(method, path, opts);
  if (opts.raw) {
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new ApiError(res.status, json?.message ?? "요청을 처리하지 못했습니다.");
    }
    return res as unknown as T;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success === false) {
    throw new ApiError(res.status, json?.message ?? `요청을 처리하지 못했습니다. (${res.status})`);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body: body ?? {} }),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
  /** GET returning the raw Response (images, files). Throws ApiError when not OK. */
  raw: (path: string, query?: Query) => request<Response>("GET", path, { query, raw: true }),

  /** Downloads a protected file (Excel export, attachments) through the token-carrying fetch. */
  async download(path: string, query?: Query, fallbackName = "download") {
    const res = await request<Response>("GET", path, { query, raw: true });
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) ?? cd.match(/filename="?([^";]+)"?/i);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(href);
      a.remove();
    }, 500);
  },
};

export interface Page<T> {
  content: T[];
  totalElements: number;
  page: number;
  size: number;
  totalPages: number;
}

/** Some list endpoints return a page, others a plain array. */
export function rows<T>(data: Page<T> | T[] | null | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.content;
}

export async function uploadFiles(files: File[]): Promise<number[]> {
  if (!files.length) return [];
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await api.upload<{ fileId: number }[]>("/api/files", form);
  return res.map((f) => f.fileId);
}
