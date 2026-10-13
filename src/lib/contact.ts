import { Linking, Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * How to reach the person running a table or a league.
 *
 * Scoped deliberately: the database only answers this for someone seated at the
 * match or in the league, so there is no point in the app asking otherwise — and
 * nothing it could do with the answer if it did. See 20260815214500.
 */
export type Contact = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

/** Null when the caller has not joined, which is a normal answer rather than an error. */
export async function fetchMatchHostContact(matchId: string): Promise<Contact | null> {
  const { data, error } = await supabase.rpc('match_host_contact', { p_match_id: matchId });

  // Swallowed on purpose. A contact lookup that fails should cost the contact
  // section, not the sheet it sits in.
  if (error) return null;
  return (data as Contact[])?.[0] ?? null;
}

export async function fetchLeagueOrganizerContact(leagueId: string): Promise<Contact | null> {
  const { data, error } = await supabase.rpc('league_organizer_contact', {
    p_league_id: leagueId,
  });

  if (error) return null;
  return (data as Contact[])?.[0] ?? null;
}

/**
 * Hands an address to the member's mail client, or a number to their dialler.
 *
 * A new tab on web rather than a navigation: `mailto:` in the current tab is
 * harmless in most browsers but not all, and the app should never be the thing
 * that disappears. Native has a real handler for both schemes.
 */
export async function openContact(scheme: 'mailto' | 'tel', value: string) {
  const url = `${scheme}:${value.trim()}`;

  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  await Linking.openURL(url);
}

export type SupportMessage = { to: string; subject: string; body: string };

/**
 * Opens a message to us, with the subject and a first question already in it.
 *
 * Separate from `openContact`, which hands over an address and nothing else. That
 * is right for writing to a host: you know what you want to say. A report is the
 * other way round — the member knows something is wrong and not what we need in
 * order to act on it, so the body asks for it.
 *
 * Encoded by hand rather than through `URLSearchParams` as `openGroupEmail` does.
 * That spells a space `+`, which is correct for a form body and wrong here: several
 * mail clients print it literally, and a subject line arriving as
 * "Reporting+something" reads as a bug in the app that sent it.
 */
export async function openSupportEmail({ to, subject, body }: SupportMessage) {
  const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  await Linking.openURL(url);
}

/** Someone a host or organizer can write to. */
export type Recipient = { name: string | null; email: string | null };

/**
 * The signed-in member's own address, for the To field of a group message.
 *
 * Read from the session rather than passed down from a screen: it is the same
 * answer everywhere, and threading it through three components to reach one button
 * would be worse than one cheap local call.
 */
export async function fetchMyEmail(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.email ?? null;
}

/**
 * The signed-in member's own card, for signing a message they are about to send.
 *
 * Assembled from three places because that is where the pieces live: the name off
 * `profiles`, the address off the auth account, the phone out of
 * `profile_contacts` — which has no row at all for somebody who never gave one,
 * hence `maybeSingle`.
 *
 * Never throws. A change of plan still has to go out for a host whose profile is
 * half-filled; the worst case is a note signed with less than it might have been.
 */
export async function fetchMyContact(): Promise<Contact> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { name: null, email: null, phone: null };

    const [profile, contact] = await Promise.all([
      supabase.from('profiles').select('name').eq('id', user.id).maybeSingle(),
      supabase.from('profile_contacts').select('phone').eq('profile_id', user.id).maybeSingle(),
    ]);

    return {
      name: profile.data?.name ?? null,
      email: user.email ?? null,
      phone: contact.data?.phone ?? null,
    };
  } catch {
    return { name: null, email: null, phone: null };
  }
}

/** Seated players, for the host of the match. Empty for anyone else. */
export async function fetchMatchPlayerEmails(matchId: string): Promise<Recipient[]> {
  const { data, error } = await supabase.rpc('match_player_contacts', { p_match_id: matchId });
  if (error) return [];
  return (data as Recipient[]) ?? [];
}

/** League members, for the organizer. Empty for anyone else. */
export async function fetchLeagueMemberEmails(leagueId: string): Promise<Recipient[]> {
  const { data, error } = await supabase.rpc('league_member_contacts', { p_league_id: leagueId });
  if (error) return [];
  return (data as Recipient[]) ?? [];
}

/**
 * Roughly where mail clients start truncating a `mailto:` URL.
 *
 * There is no specified limit and every client picks its own; 2000 characters is
 * the figure everything in practice handles. Addresses average around 25
 * characters, so this leaves generous room for a subject and a body stub.
 */
const MaxUrlLength = 1900;

export type GroupEmail = {
  /** The sender's own address, so they keep a copy and the To field is not empty. */
  self: string | null;
  recipients: Recipient[];
  subject: string;
  body: string;
};

/**
 * Opens a message to everyone who joined, addressed so they cannot see each other.
 *
 * BCC, deliberately. The people at a table have not agreed to have their addresses
 * handed to the other players, and a To field would do exactly that on the first
 * message and forever after through reply-all. The trade is that group replies do
 * not work — anyone answering reaches only the host — which is the right way round
 * for an announcement.
 *
 * The sender goes in To, which keeps them a copy and avoids the empty-To field some
 * clients refuse to open.
 *
 * Returns the number of people left out when the list is too long for a URL, so the
 * caller can say so rather than silently sending to a truncated group.
 */
export async function openGroupEmail({ self, recipients, subject, body }: GroupEmail) {
  const addresses = recipients
    .map((person) => person.email)
    .filter((email): email is string => Boolean(email));

  if (addresses.length === 0) return { sent: 0, omitted: 0 };

  const build = (chosen: string[]) => {
    const params = new URLSearchParams({ bcc: chosen.join(','), subject, body });
    return `mailto:${self ?? ''}?${params.toString()}`;
  };

  // Drop from the end until it fits. A league of two hundred cannot go in one
  // URL, and a message that quietly reached the first eighty would be worse than
  // one that says who it missed.
  let chosen = addresses;
  while (chosen.length > 1 && build(chosen).length > MaxUrlLength) {
    chosen = chosen.slice(0, -1);
  }

  const url = build(chosen);

  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    await Linking.openURL(url);
  }

  return { sent: chosen.length, omitted: addresses.length - chosen.length };
}
