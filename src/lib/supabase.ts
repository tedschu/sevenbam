import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in your Supabase project values.'
  );
}

// Create a custom storage adapter that safely falls back when rendering on the server
const CustomStorageAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, value);
      }
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};

/**
 * The address the browser arrived on, read before any auth client exists.
 *
 * `detectSessionInUrl` strips the tokens and the `type=recovery` marker out of the
 * URL as the client initialises — which happens on import, before any component has
 * mounted. Anything that needs to know *how* this page was reached has to have
 * looked already, so the look happens here, above `createClient`, where module order
 * guarantees it runs first.
 *
 * Empty string off the browser: there is no URL to read while server-rendering.
 */
export const landingHash =
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hash : '';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: CustomStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Google sends the member back to the app with the auth code in the URL.
    // On web the browser must read it; on native the deep link is handled by
    // hand in the sign-in call, and leaving this on would double-handle it.
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

/**
 * A second client that exists only to send password recovery emails.
 *
 * PKCE is right for sign-in — the browser keeps half the pair, so an intercepted
 * code is worth nothing — but it is wrong for recovery, because the two halves have
 * to meet in the same browser. Somebody asks for a link on their laptop, opens the
 * mail on their phone, and the exchange has nothing to match against: the reset
 * fails, silently, and they are dropped into the app instead. That is the most
 * common way there is to open an email, so recovery goes the other way and sends a
 * link that carries everything it needs.
 *
 * Deliberately inert otherwise: no session storage, no refresh, no URL parsing. It
 * sends one request and nothing else, and its own `storageKey` keeps it from ever
 * writing over the real session.
 */
export const recoveryClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'sevenbam-recovery',
    flowType: 'implicit',
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
