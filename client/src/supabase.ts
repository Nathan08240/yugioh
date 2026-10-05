import { AuthClient } from "@supabase/auth-js";

// Only the login is used: the auth client alone, set up as supabase-js does it (same session key, stored sessions stay valid).
const base = import.meta.env.VITE_SUPABASE_URL;
const url = new URL(base.endsWith("/") ? base : `${base}/`);
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = {
  auth: new AuthClient({
    url: new URL("auth/v1", url).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    storageKey: `sb-${url.hostname.split(".")[0]}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "implicit",
  }),
};
