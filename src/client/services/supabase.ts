/**
 * Local user session manager (no Supabase dependency)
 */

export function getSupabase(): null {
  return null;
}

export async function initAuthSession(): Promise<{ user: null; token: null }> {
  return { user: null, token: null };
}

export function getCurrentToken(): string | null {
  return null;
}

export function getCurrentUserId(): string {
  let guestId = localStorage.getItem('madura_guest_user_id');
  if (!guestId) {
    guestId = `user-${Math.random().toString(36).slice(2, 11)}-${Date.now()}`;
    localStorage.setItem('madura_guest_user_id', guestId);
  }
  return guestId;
}
