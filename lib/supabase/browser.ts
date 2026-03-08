// vercel rebuild fix
// rebuild trigger
import { createPagesBrowserClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "./types";

export function createBrowserSupabaseClient() {
  return createPagesBrowserClient<Database>();
}