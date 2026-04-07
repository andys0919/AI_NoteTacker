import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?bundle';
import { createOperatorAuthSession } from '/operator-auth-session.js';

export const createOperatorAuthClient = async () => {
  const response = await fetch('/api/auth/config');
  const payload = await response.json();

  const enabled = Boolean(payload.enabled && payload.supabaseUrl && payload.supabasePublishableKey);

  const supabase = enabled
    ? createClient(payload.supabaseUrl, payload.supabasePublishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true
        }
      })
    : null;

  if (!enabled || !supabase) {
    return createOperatorAuthSession({
      enabled: false,
      redirectUrl: window.location.origin,
      storage: window.localStorage,
      supabase: null
    });
  }

  const currentUrl = new URL(window.location.href);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const code = currentUrl.searchParams.get('code');

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (error) {
      throw error;
    }

    currentUrl.hash = '';
    window.history.replaceState({}, document.title, `${currentUrl.pathname}${currentUrl.search}`);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      throw error;
    }

    currentUrl.searchParams.delete('code');
    window.history.replaceState({}, document.title, `${currentUrl.pathname}${currentUrl.search}`);
  }

  return createOperatorAuthSession({
    enabled: true,
    redirectUrl: `${window.location.origin}${window.location.pathname}`,
    storage: window.localStorage,
    supabase
  });
};
