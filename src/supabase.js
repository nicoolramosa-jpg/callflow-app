import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Do not put a service_role/secret key in this file or in VITE_ variables.
export const supabase = url && key ? createClient(url, key) : null;