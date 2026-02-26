import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Server-side client with full access (for data pipeline / API routes)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Client-side client with anon key (for frontend reads)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

