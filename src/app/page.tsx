import Link from 'next/link';

import { ButtonLink } from '@/components/ui';

const STEPS = [
  {
    title: 'Σύνδεση με myDATA',
    body: 'Καταχωρείτε τα διαπιστευτήρια της ΑΑΔΕ μία φορά. Τα τιμολόγιά σας συγχρονίζονται αυτόματα.',
  },
  {
    title: 'Αυτόματες υπενθυμίσεις',
    body: 'Τρία σταθερά βήματα: ευγενική υπενθύμιση πριν τη λήξη, ειδοποίηση στις 2 ημέρες καθυστέρησης, τελική στις 10.',
  },
  {
    title: 'Άμεση εξόφληση',
    body: 'Κάθε μήνυμα περιέχει σύνδεσμο πληρωμής με κάρτα. Η εξόφληση σταματά αυτόματα τη ροή.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-base font-semibold tracking-tight">
            lefta<span className="text-brand-500">.app</span>
          </span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-ink-600 hover:text-ink-900">
              Σύνδεση
            </Link>
            <ButtonLink href="/register">Δωρεάν δοκιμή</ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-20 text-center">
          <h1 className="mx-auto max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
            Πληρωθείτε στην ώρα σας, χωρίς δύσκολα τηλεφωνήματα.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
            Το lefta.app συνδέεται με το myDATA, παρακολουθεί τα ανεξόφλητα τιμολόγιά σας και
            στέλνει αυτόματες, ευγενικές υπενθυμίσεις με σύνδεσμο άμεσης πληρωμής.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/register" className="px-5 py-2.5 text-base">
              Ξεκινήστε δωρεάν
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="px-5 py-2.5 text-base">
              Έχω λογαριασμό
            </ButtonLink>
          </div>
        </section>

        <section className="grid gap-5 pb-20 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
              <span className="tabular inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <h2 className="mt-4 text-base font-semibold text-ink-900">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="mb-20 rounded-xl border border-ink-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-ink-900">Πάροχος λογισμικού, όχι εισπρακτική</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-600">
            Το lefta.app διαβιβάζει υπενθυμίσεις για λογαριασμό σας. Δεν αναλαμβάνει απαιτήσεις, δεν
            διαπραγματεύεται οφειλές και δεν ασκεί πίεση. Η ροή είναι σταθερή, με ανώτατο όριο{' '}
            <strong className="font-semibold text-ink-800">μία επαφή ανά πελάτη ανά ημέρα</strong>,
            και κάθε μήνυμα καταγράφεται σε πλήρες, μη τροποποιήσιμο αρχείο.
          </p>
        </section>
      </main>

      <footer className="border-t border-ink-200 py-8 text-center text-xs text-ink-500">
        © {new Date().getFullYear()} lefta.app
      </footer>
    </div>
  );
}
