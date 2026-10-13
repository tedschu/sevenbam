import { Toggle } from '@/components/kit/controls';
import { Card } from '@/components/kit/layout';
import { setGlobalView, useGlobalView, useIsAdmin } from '@/hooks/use-global-view';

/**
 * The admin's "see everything" switch, on Profile — the only surface every
 * platform has for it once the bar is the same bottom tab bar everywhere.
 *
 * It used to have a second shape too: a chip in the corner of a wide web top
 * bar, for an admin doing a round of checks without leaving the screen they
 * were on. That bar is gone — the redesign put one bottom bar on every
 * platform, with no such corner — so this row is what is left, and it now has
 * to be the whole answer rather than the narrow-layout fallback.
 *
 * Draws nothing at all for a non-admin, so it can be rendered unconditionally
 * by whatever contains it.
 */
export function GlobalViewRow() {
  const isAdmin = useIsAdmin();
  const globalView = useGlobalView();

  if (!isAdmin) return null;

  return (
    <Card>
      <Toggle
        value={globalView}
        onValueChange={setGlobalView}
        label={globalView ? 'Seeing everything' : 'Seeing your own'}
        description={
          globalView
            ? 'Every league and match in the app, including ones you are not in. You cannot change anything you are not already an organizer of, and looking does not join you to anything.'
            : 'The app as any member sees it: the leagues you belong to and the matches you can join.'
        }
      />
    </Card>
  );
}
