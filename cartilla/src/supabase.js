import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Use the project's public/publishable key only. Never expose a service-role key.
export const supabase = url && key ? createClient(url, key) : null;