export class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  constructor(status: number, statusText: string, body: unknown) {
    super(`${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export interface RequestOpts {
  headers?: Record<string, string>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `/api${path}`;
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("auth_token");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new ApiError(response.status, response.statusText, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function mergeHeaders(opts?: RequestOpts): RequestInit | undefined {
  if (!opts?.headers) return undefined;
  // Bearer token wins on collision: strip any caller-supplied Authorization.
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.headers)) {
    if (key.toLowerCase() === "authorization") continue;
    filtered[key] = value;
  }
  return { headers: filtered };
}

export const api = {
  get<T>(path: string, _body?: undefined, opts?: RequestOpts): Promise<T> {
    return request<T>(path, mergeHeaders(opts));
  },

  post<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      ...mergeHeaders(opts),
    });
  },

  put<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
      ...mergeHeaders(opts),
    });
  },

  patch<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      ...mergeHeaders(opts),
    });
  },

  delete<T>(path: string, _body?: undefined, opts?: RequestOpts): Promise<T> {
    return request<T>(path, { method: "DELETE", ...mergeHeaders(opts) });
  },
};
