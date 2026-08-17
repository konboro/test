import Link from 'next/link';

import { LeftaLogo, LeftaMark } from '@/components/logo';
import { ButtonLink } from '@/components/ui';

const STEPS = [
  {
    title: 'Συνδέετε τα βιβλία σας',
    body: 'Elorus ή myDATA (ΑΑΔΕ), μία φορά. Πελάτες, ποσά και πραγματικές ημερομηνίες λήξης συγχρονίζονται μόνα τους — δεν πληκτρολογείτε τίποτα δύο φορές.',
  },
  {
    title: 'Οι υπενθυμίσεις φεύγουν μόνες τους',
    body: 'Τρία σταθερά βήματα, με τα δικά σας κείμενα: ευγενική υπενθύμιση πριν τη λήξη, ειδοποίηση στις 2 ημέρες καθυστέρησης, τελική στις 10.',
  },
  {
    title: 'Ο πελάτης πληρώνει με ένα κλικ',
    body: 'Κάθε μήνυμα έχει σύνδεσμο πληρωμής με κάρτα. Μόλις εξοφληθεί, η ροή σταματά αυτόματα — κανείς δεν λαμβάνει υπενθύμιση για τιμολόγιο που πλήρωσε.',
  },
];

const FEATURES = [
  {
    title: 'Συγχρονισμός τιμολογίων',
    body: 'Elorus και myDATA. Τα ανεξόφλητα εμφανίζονται με το όνομα του πελάτη, το ποσό και την πραγματική ημερομηνία λήξης του κάθε παραστατικού.',
  },
  {
    title: 'Email και SMS',
    body: 'Η υπενθύμιση πριν τη λήξη φεύγει με email. Στις καθυστερήσεις προστίθεται και SMS, γιατί διαβάζεται.',
  },
  {
    title: 'Τα δικά σας λόγια',
    body: 'Επεξεργάζεστε κάθε μήνυμα με ζωντανή προεπισκόπηση. Στα SMS βλέπετε πόσα τμήματα χρεώνονται όσο γράφετε.',
  },
  {
    title: 'Σύντομος σύνδεσμος πληρωμής',
    body: 'Της μορφής lefta.app/KΩΔΙΚΟΣ — χωρεί σε ένα SMS και δεν μοιάζει με ανεπιθύμητο μήνυμα.',
  },
  {
    title: 'Αντιστοίχιση εμβασμάτων',
    body: 'Διαβάζει τον λογαριασμό σας και κλείνει τα τιμολόγια που εξηγούν οι εισπράξεις. Τα εμβάσματα σταματούν να είναι το τυφλό σημείο.',
  },
  {
    title: 'Ηλικίωση και πλήρες αρχείο',
    body: 'Πόσο καθυστερεί κάθε οφειλή, σε μία στήλη. Κάθε μήνυμα που στάλθηκε καταγράφεται με ώρα, παραλήπτη και περιεχόμενο.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <LeftaLogo />
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-ink-600 transition hover:text-ink-900"
            >
              Σύνδεση
            </Link>
            <ButtonLink href="/register">Δωρεάν δοκιμή</ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 text-center sm:py-20">
          <LeftaMark className="mx-auto h-16 w-16 sm:h-20 sm:w-20" />
          <h1 className="mx-auto mt-8 max-w-2xl text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
            Πληρωθείτε στην ώρα σας, χωρίς δύσκολα τηλεφωνήματα.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-600 sm:text-lg">
            Το lefta.app παρακολουθεί τα ανεξόφλητα τιμολόγιά σας, στέλνει τις υπενθυμίσεις για
            λογαριασμό σας και δίνει στον πελάτη σύνδεσμο άμεσης εξόφλησης. Εσείς ασχολείστε με τη
            δουλειά σας.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/register" variant="brand" className="px-5 py-2.5 text-base">
              Ξεκινήστε δωρεάν
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="px-5 py-2.5 text-base">
              Έχω λογαριασμό
            </ButtonLink>
          </div>
        </section>

        <section className="grid gap-5 pb-16 sm:grid-cols-3 sm:pb-20">
          {STEPS.map((step, index) => (
            <div
              key={step.title}
              className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm"
            >
              <span className="tabular inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <h2 className="mt-4 text-base font-semibold text-ink-900">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="pb-16 sm:pb-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink-900">
            Τι περιλαμβάνει
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The single most common question a Greek SME asks about a service like
            this, so it gets its own section rather than a line in the footer. */}
        <section className="mb-16 overflow-hidden rounded-xl border border-brand-100 bg-brand-50 sm:mb-20">
          <div className="p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-ink-900">
              Τα χρήματα πηγαίνουν απευθείας σε εσάς
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-700">
              Συνδέετε τον δικό σας λογαριασμό <strong className="font-semibold">Stripe</strong> ή{' '}
              <strong className="font-semibold">Viva.com</strong> και οι πληρωμές εισπράττονται εκεί.
              Το lefta.app δεν μεσολαβεί στη ροή χρημάτων, δεν κρατά προμήθεια και δεν εμφανίζεται
              στη συναλλαγή. Δεν περιμένετε κανέναν να σας αποδώσει τα δικά σας χρήματα.
            </p>
          </div>
        </section>

        <section className="mb-16 rounded-xl border border-ink-200 bg-white p-6 sm:mb-20">
          <h2 className="text-sm font-semibold text-ink-900">
            Πάροχος λογισμικού, όχι εισπρακτική εταιρεία
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">
            Το lefta.app διαβιβάζει υπενθυμίσεις για λογαριασμό σας. Δεν αναλαμβάνει απαιτήσεις, δεν
            διαπραγματεύεται οφειλές και δεν ασκεί πίεση. Η ροή είναι σταθερή, με ανώτατο όριο{' '}
            <strong className="font-semibold text-ink-800">μία επαφή ανά πελάτη ανά ημέρα</strong>,
            κάθε μήνυμα καταγράφεται σε πλήρες, μη τροποποιήσιμο αρχείο, και μπορείτε ανά πάσα στιγμή
            να θέσετε έναν πελάτη σε παύση.
          </p>
        </section>

        <section className="mb-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
            Δείτε τι σας χρωστούν σήμερα
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-600">
            Η σύνδεση με τα βιβλία σας παίρνει λίγα λεπτά. Καμία υπενθύμιση δεν φεύγει προτού την
            εγκρίνετε εσείς.
          </p>
          <ButtonLink href="/register" variant="brand" className="mt-6 px-5 py-2.5 text-base">
            Ξεκινήστε δωρεάν
          </ButtonLink>
        </section>
      </main>

      <footer className="border-t border-ink-200 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4">
          <LeftaLogo markClassName="h-6 w-6" textClassName="text-sm" />
          <p className="text-xs text-ink-500">© {new Date().getFullYear()} lefta.app</p>
        </div>
      </footer>
    </div>
  );
}
