/**
 * Builds the Supabase auth email templates.
 *
 * Supabase reads each template as a standalone HTML file, so the four of them
 * repeat the same forty lines of table scaffolding. Written by hand they would
 * drift apart the first time a colour changed — one of them would keep the old
 * button and nobody would notice, because these are the emails a tenant sees
 * once and never mentions.
 *
 * The shell here is the same one `lib/dunning/templates.ts` renders for
 * reminders: same slate background, same mark, same card, same button. A
 * confirmation email that looks like a different company than the reminders is
 * the problem this set exists to fix.
 *
 * The output is committed. Run `node scripts/build-auth-emails.mjs` after
 * editing this file, and commit what it writes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'templates');

/**
 * @param {{ title: string, body: string, cta: string, footer: string, english: string }} copy
 */
function shell({ title, body, cta, footer, english }) {
  return `<!doctype html>
<html lang="el">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${title}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 4px 14px;">
                <!-- The mark, drawn as a coloured cell with a lambda glyph rather
                     than an image: Gmail strips inline SVG and a hosted image is
                     blocked until the reader opts in, which would leave the
                     brand invisible on first open — the one open that matters. -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="22" height="22" align="center" valign="middle" style="width:22px;height:22px;background:#4c6ef5;border-radius:5px;font-size:15px;line-height:22px;font-weight:700;color:#ffffff;">&#955;</td>
                  <td style="padding-left:8px;font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;white-space:nowrap;">
                    lefta<span style="color:#3b6df5;">.app</span>
                  </td>
                </tr></table>
              </td>
            </tr>

            <tr>
              <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:32px 32px 0;">
                      <h1 style="margin:0;font-size:20px;line-height:1.35;font-weight:600;letter-spacing:-0.01em;color:#0f172a;">${title}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 32px 8px;font-size:15px;line-height:1.65;color:#334155;">
                      <p style="margin:0;">${body}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 32px 32px;">
                      <!-- A padded table cell rather than a padded anchor, because
                           Outlook ignores padding on an inline-block link. -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td bgcolor="#2b55d4" style="border-radius:10px;">
                            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                              ${cta}
                            </a>
                          </td>
                        </tr>
                      </table>

                      <!-- The same link in full, for a client that strips the
                           button or a reader who would rather see where it goes
                           before pressing it. -->
                      <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
                        <a href="{{ .ConfirmationURL }}" style="color:#2b55d4;text-decoration:none;">{{ .ConfirmationURL }}</a>
                      </p>

                      <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #f1f5f9;font-size:13px;line-height:1.6;color:#64748b;">
                        ${english}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 8px 0;font-size:12px;line-height:1.7;color:#64748b;">
                ${footer}<br />
                Ο σύνδεσμος ισχύει για περιορισμένο χρονικό διάστημα.
              </td>
            </tr>

            <tr>
              <td style="padding:14px 8px 0;font-size:12px;line-height:1.7;color:#94a3b8;">
                lefta.app — αυτοματοποιημένη διαχείριση εισπράξεων
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const TEMPLATES = {
  'confirmation.html': {
    title: 'Επιβεβαιώστε το email σας',
    body: 'Καλώς ήρθατε στη lefta.app. Πατήστε το κουμπί για να ενεργοποιήσετε τον λογαριασμό σας και να δείτε τι σας οφείλουν.',
    cta: 'Επιβεβαίωση email',
    footer:
      'Αν δεν δημιουργήσατε λογαριασμό στη lefta.app, αγνοήστε αυτό το μήνυμα — δεν θα γίνει τίποτα.',
    english: 'Confirm your email address to activate your lefta.app account.',
  },
  'magic_link.html': {
    title: 'Σύνδεση στη lefta.app',
    body: 'Πατήστε το κουμπί για να συνδεθείτε. Δεν χρειάζεται κωδικός.',
    cta: 'Σύνδεση',
    footer:
      'Αν δεν ζητήσατε αυτόν τον σύνδεσμο, αγνοήστε το μήνυμα — κανείς δεν μπορεί να συνδεθεί χωρίς αυτό το email.',
    english: 'Use the button above to sign in to lefta.app. No password needed.',
  },
  'recovery.html': {
    title: 'Επαναφορά κωδικού',
    body: 'Ζητήσατε νέο κωδικό για τον λογαριασμό σας στη lefta.app. Πατήστε το κουμπί για να ορίσετε έναν.',
    cta: 'Ορισμός νέου κωδικού',
    footer:
      'Αν δεν το ζητήσατε εσείς, αγνοήστε το μήνυμα — ο κωδικός σας παραμένει ο ίδιος μέχρι να χρησιμοποιηθεί αυτός ο σύνδεσμος.',
    english: 'Set a new password for your lefta.app account.',
  },
  'email_change.html': {
    title: 'Επιβεβαιώστε τη νέα διεύθυνση',
    body: 'Ζητήθηκε αλλαγή της διεύθυνσης του λογαριασμού σας σε {{ .NewEmail }}. Πατήστε το κουμπί για να την επιβεβαιώσετε.',
    cta: 'Επιβεβαίωση διεύθυνσης',
    footer:
      'Αν δεν ζητήσατε την αλλαγή, αγνοήστε το μήνυμα — η διεύθυνσή σας δεν αλλάζει χωρίς αυτή την επιβεβαίωση.',
    english: 'Confirm the new email address for your lefta.app account.',
  },
};

mkdirSync(OUT, { recursive: true });

for (const [name, copy] of Object.entries(TEMPLATES)) {
  writeFileSync(join(OUT, name), shell(copy), 'utf8');
  console.log('wrote supabase/templates/' + name);
}
