const PENDING_EMAIL_KEY = 'operator-auth-pending-email';

export const createOperatorAuthSession = ({ enabled, redirectUrl, storage, supabase }) => {
  if (!enabled) {
    return {
      enabled: false,
      authorizedFetch: (input, init) => fetch(input, init),
      getCurrentUser: async () => null,
      getPendingEmail: () => null,
      onAuthStateChange: () => () => {},
      requestEmailOtp: async () => {
        throw new Error('Operator auth is not configured.');
      },
      signOut: async () => {},
      verifyEmailOtp: async () => null
    };
  }

  return {
    enabled: true,
    authorizedFetch: async (input, init = {}) => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const headers = new Headers(init.headers ?? {});

      if (session?.access_token) {
        headers.set('authorization', `Bearer ${session.access_token}`);
      }

      return fetch(input, {
        ...init,
        headers
      });
    },
    getCurrentUser: async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      return session?.user ?? null;
    },
    getPendingEmail: () => storage.getItem(PENDING_EMAIL_KEY),
    onAuthStateChange: (handler) => {
      const {
        data: { subscription }
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          storage.removeItem(PENDING_EMAIL_KEY);
        }

        handler(session?.user ?? null);
      });

      return () => {
        subscription.unsubscribe();
      };
    },
    requestEmailOtp: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({
        email
      });

      if (error) {
        throw error;
      }

      storage.setItem(PENDING_EMAIL_KEY, email);
    },
    signOut: async () => {
      await supabase.auth.signOut();
      storage.removeItem(PENDING_EMAIL_KEY);
    },
    verifyEmailOtp: async (token) => {
      const email = storage.getItem(PENDING_EMAIL_KEY);

      if (!email) {
        throw new Error('Missing pending email for OTP verification.');
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email'
      });

      if (error) {
        throw error;
      }

      if (data?.session?.user) {
        storage.removeItem(PENDING_EMAIL_KEY);
      }

      return data?.session?.user ?? null;
    }
  };
};
