import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Whether this account may read the whole app, and whether it is currently doing
 * so.
 *
 * Two separate facts on purpose. Being an admin is a property of the account and
 * decides only whether the toggle is drawn; being *in* global view is a choice
 * made per session, and starts off. The point of the toggle is to see what an
 * ordinary member sees, so the ordinary view has to be the default — an admin who
 * is permanently in global view has quietly lost the ability to check the thing
 * they most need to check.
 *
 * Deliberately not persisted. It survives navigating between tabs, because the
 * store outlives every screen, and dies on reload. A viewing mode that silently
 * outlasts the session it was turned on in is how somebody ends up reporting a
 * bug about seeing leagues they are not in.
 *
 * Kept in a module-level store for the same reason as [[use-profile-setup]]: the
 * control lives in the tab bar, which is mounted for the whole session and never
 * re-runs a screen's effects, while the screens that answer to it are mounted and
 * unmounted underneath it.
 */
let isAdmin = false;
let globalView = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Asks the database whether this account is an admin.
 *
 * The answer comes from `is_admin()`, which reads the caller's own id out of the
 * token — there is no argument to it, so a client that lied about who it was
 * would only be lying to itself. Nothing here is a permission: the toggle decides
 * what is *requested*, and the row-level policies decide what comes back. A
 * tampered client that forced `globalView` on would get exactly the same rows a
 * member gets.
 *
 * Fails quiet. Not knowing you are an admin costs a toggle; an error thrown out
 * of the tab bar would cost the whole screen.
 */
export async function refreshAdminStatus() {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      isAdmin = false;
      globalView = false;
      emit();
      return;
    }

    const { data, error } = await supabase.rpc('is_admin');
    if (error) return;

    isAdmin = data === true;
    // An account that has stopped being an admin must not be left in global view
    // with no way to leave it, since the toggle stops being drawn.
    if (!isAdmin) globalView = false;
    emit();
  } catch {
    // See above.
  }
}

/** Drops both facts, for sign-out. */
export function clearAdminStatus() {
  isAdmin = false;
  globalView = false;
  emit();
}

export function setGlobalView(next: boolean) {
  // Guarded rather than trusted. The control is only drawn for admins, but this
  // is exported, and a non-admin in global view would send every screen down the
  // unfiltered query path to be handed back exactly what it started with — a
  // confusing no-op rather than an honest one.
  globalView = next && isAdmin;
  emit();
}

export function useIsAdmin() {
  return useSyncExternalStore(
    subscribe,
    () => isAdmin,
    // Server snapshot for the static web export. Never an admin on first paint:
    // the RPC has not run, and a control that appears and then vanishes is worse
    // than one that arrives a moment late.
    () => false
  );
}

export function useGlobalView() {
  return useSyncExternalStore(
    subscribe,
    () => globalView,
    () => false
  );
}
