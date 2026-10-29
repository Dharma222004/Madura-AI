import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL || 'https://lpiylqfxfdddnhpnzwfc.supabase.co';
const SUPABASE_KEY = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_WUKkS9J91fLfsjyu-JV5Zw_H3n_7xOE';

let supabaseClient: SupabaseClient | null = null;
let currentUser: User | null = null;
let currentToken: string | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('your_supabase')) {
    return null;
  }
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    return supabaseClient;
  } catch (err) {
    console.warn('[Supabase Client] Failed to initialize:', err);
    return null;
  }
}

/**
 * Initializes authenticated session for the user.
 * Recovers stored session or creates an anonymous session so each user has an isolated user ID in Supabase.
 */
export async function initAuthSession(): Promise<{ user: User | null; token: string | null }> {
  const sb = getSupabase();
  if (!sb) return { user: null, token: null };

  try {
    const { data: sessionData } = await sb.auth.getSession();
    if (sessionData.session) {
      currentUser = sessionData.session.user;
      currentToken = sessionData.session.access_token;
      return { user: currentUser, token: currentToken };
    }

    // Try signing in anonymously if enabled in Supabase project
    try {
      const { data: anonData, error: anonErr } = await sb.auth.signInAnonymously();
      if (!anonErr && anonData.session) {
        currentUser = anonData.session.user;
        currentToken = anonData.session.access_token;
        return { user: currentUser, token: currentToken };
      }
    } catch {
      // Anonymous sign-in not enabled on project; fallback to guest user
    }
  } catch (err) {
    console.warn('[Supabase Auth] Session initialization error:', err);
  }

  return { user: currentUser, token: currentToken };
}

export function getCurrentToken(): string | null {
  return currentToken;
}

export function getCurrentUserId(): string {
  if (currentUser?.id) return currentUser.id;
  // Local persistent guest ID stored in localStorage
  let guestId = localStorage.getItem('madura_guest_user_id');
  if (!guestId) {
    guestId = `guest-${Math.random().toString(36).slice(2, 11)}-${Date.now()}`;
    localStorage.setItem('madura_guest_user_id', guestId);
  }
  return guestId;
}
