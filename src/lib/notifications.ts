import { supabase } from './supabase';

/**
 * The two email switches, as the profile screen thinks about them.
 *
 * Not one per kind of mail. What somebody wants to decide is "tell me when a game
 * I am in comes together" and "tell me when it falls apart"; which database notice
 * that maps to is `wants_notice`'s problem, in 20260909130000. A settings screen
 * with a row for every message the service might ever send is how a preference
 * page becomes something nobody reads.
 */
export type NotificationSettings = {
  game_is_on: boolean;
  someone_drops_out: boolean;
};

/**
 * On by default, and used whenever the row cannot be read.
 *
 * The same call the database makes for a missing row, and for the same reason: the
 * failure that matters here is silence. Somebody who never learns their game fell
 * apart, and cannot work out why, is worse off than somebody who got one email
 * they had meant to switch off.
 */
export const AllOn: NotificationSettings = { game_is_on: true, someone_drops_out: true };

/**
 * This member's switches. A row is created alongside every profile, so a missing
 * one means something is wrong rather than that they have never visited this
 * screen — either way the honest answer is the default.
 */
export async function fetchMyNotificationSettings(
  userId: string
): Promise<NotificationSettings> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('game_is_on, someone_drops_out')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? AllOn;
}

/**
 * Change one switch.
 *
 * Update rather than upsert: the row is the trigger's to create, and the grant is
 * scoped to these two columns precisely so a member cannot choose their own
 * unsubscribe token. An upsert would ask for insert rights this has no business
 * holding.
 */
export async function updateMyNotificationSettings(
  userId: string,
  next: Partial<NotificationSettings>
) {
  const { error } = await supabase
    .from('notification_settings')
    .update(next)
    .eq('profile_id', userId);

  if (error) throw error;
}
