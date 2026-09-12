import type { Locale } from './i18n/dictionaries';

/**
 * The privacy notice and the terms.
 *
 * Written from what the system actually does rather than from a template: the
 * two roles it holds at once, the sub-processors it really calls, the fields it
 * really stores, and the region the database really runs in. A notice assembled
 * from boilerplate would describe a different product, and the first person to
 * check would find that out.
 *
 * Held as data, like the guides, so both languages stay in step and neither can
 * be broken by stray markup.
 *
 * ---------------------------------------------------------------------------
 * The operator is a Polish company, and the identifiers it must publish are
 * Polish ones: KRS with its registry court, NIP, and share capital — what the
 * Commercial Companies Code asks of a sp. z o.o. on its commercial
 * communications. The Greek ΑΦΜ this record used to hold was never going to be
 * the right field.
 *
 * Anything still unknown is null, and null renders as nothing at all rather
 * than as a bracketed placeholder. The pages then say the things that are
 * true — the company's name — and stay silent about the rest, which is better
 * on a live page than "[ΑΦΜ]" and far better than a number somebody guessed.
 * `LEGAL_ENTITY_MISSING` is what keeps that from going quiet: it names what is
 * still owed, and the tests fail if the company itself is ever unnamed again.
 * ---------------------------------------------------------------------------
 */
export interface LegalEntity {
  /** Full legal name, exactly as registered. */
  name: string;
  /** Registered office: street, postcode, city, country. */
  address: string | null;
  /** The registry court holding the company file. */
  registryCourt: string | null;
  /** Companies-register number (Krajowy Rejestr Sądowy). */
  krs: string | null;
  /** Polish tax identification number. */
  nip: string | null;
  /** Statistical number. Nine digits for a legal entity. */
  regon: string | null;
  /** Share capital as registered, including the currency. */
  shareCapital: string | null;
  /** Where a data-protection request actually lands. */
  email: string | null;
}

export const LEGAL_ENTITY: LegalEntity = {
  name: 'Mobimetry sp. z o.o.',
  // As registered, typeset the way Polish addresses are written. Only the
  // letter case and the comma before the postcode differ from the register's
  // own all-caps rendering; every component is the registered one.
  address: 'pl. Tadeusza Kościuszki 5 m. 1A, 50-029 Wrocław, Polska',
  // From the company's KRS extract, not inferred from the seat: the city gives
  // you the court but not the division, and there are two that keep the
  // register in Wrocław.
  registryCourt:
    'Sąd Rejonowy dla Wrocławia-Fabrycznej we Wrocławiu, VI Wydział Gospodarczy Krajowego Rejestru Sądowego',
  krs: '0001265140',
  nip: '8971978439',
  // Nine digits, which is the REGON of a legal entity. It arrived as
  // '54567601400000' — that is this number padded to the fourteen-character
  // field some registers print, and as a fourteen-digit REGON it fails its own
  // checksum, while these nine pass. The tests re-check both every run.
  regon: '545676014',
  shareCapital: null,
  email: null,
};

/**
 * What the identity block still needs before these documents are complete.
 *
 * A notice with no contact channel gives a data subject nowhere to exercise a
 * right, and a sp. z o.o. that publishes no KRS or NIP is short of its own
 * disclosure duty. Neither is a reason to invent a value, and both are a
 * reason to be able to see at a glance what is outstanding.
 */
export const LEGAL_ENTITY_MISSING: ReadonlyArray<keyof LegalEntity> = (
  ['email', 'address', 'registryCourt', 'krs', 'nip', 'regon', 'shareCapital'] as const
).filter((field) => LEGAL_ENTITY[field] === null);

const IDENTITY_LABELS: Record<Locale, { court: string; capital: string; email: string }> = {
  el: { court: 'Δικαστήριο μητρώου', capital: 'Μετοχικό κεφάλαιο', email: 'Email' },
  en: { court: 'Registry court', capital: 'Share capital', email: 'Email' },
};

/**
 * The company's identity, as one line, from whatever is actually known.
 *
 * One function rather than four hand-written sentences: the same line closes
 * the privacy notice, the terms and the site footer, and a company detail that
 * arrives later has to reach all three or none.
 */
export function entityIdentity(locale: Locale): string {
  const label = IDENTITY_LABELS[locale];

  const parts = [
    LEGAL_ENTITY.name,
    LEGAL_ENTITY.address,
    LEGAL_ENTITY.krs
      ? `KRS ${LEGAL_ENTITY.krs}${LEGAL_ENTITY.registryCourt ? ` (${label.court}: ${LEGAL_ENTITY.registryCourt})` : ''}`
      : null,
    LEGAL_ENTITY.nip ? `NIP ${LEGAL_ENTITY.nip}` : null,
    LEGAL_ENTITY.regon ? `REGON ${LEGAL_ENTITY.regon}` : null,
    LEGAL_ENTITY.shareCapital ? `${label.capital}: ${LEGAL_ENTITY.shareCapital}` : null,
    LEGAL_ENTITY.email ? `${label.email}: ${LEGAL_ENTITY.email}` : null,
  ].filter((part): part is string => Boolean(part));

  const line = parts.join(', ');

  // "sp. z o.o." already ends in a full stop, and a sentence closer after it
  // renders as "Mobimetry sp. z o.o..". Abbreviated company forms are the rule
  // rather than the exception — sp. z o.o., S.A., Ltd., A.E. — so the closer is
  // conditional rather than the name being special-cased.
  return line.endsWith('.') ? line : `${line}.`;
}

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  title: string;
  /** Also the meta description. */
  summary: string;
  /** ISO date. Shown, because a policy with no date tells you nothing. */
  updated: string;
  sections: LegalSection[];
}

const PRIVACY_EL: LegalDocument = {
  title: 'Πολιτική απορρήτου',
  summary:
    'Ποια δεδομένα επεξεργάζεται το lefta.app, για ποιον, με ποια βάση και για πόσο.',
  updated: '2026-09-12',
  sections: [
    {
      heading: 'Δύο ρόλοι, όχι ένας',
      paragraphs: [
        `Για τα δεδομένα του λογαριασμού σας — email, επωνυμία, ΑΦΜ, ρυθμίσεις — η ${LEGAL_ENTITY.name} είναι υπεύθυνος επεξεργασίας.`,
        'Για τα δεδομένα των πελατών σας που ανεβάζετε ή συγχρονίζετε, το lefta.app είναι εκτελών την επεξεργασία και ενεργεί μόνο κατ’ εντολή σας. Υπεύθυνος επεξεργασίας παραμένετε εσείς: εσείς αποφασίζετε ποιον χρεώνετε, τι του στέλνετε και πότε.',
        'Η διάκριση δεν είναι τυπική. Ο οφειλέτης που λαμβάνει μια υπενθύμιση δεν έγγραψε ποτέ λογαριασμό εδώ και δεν συμφώνησε με τίποτα απέναντί μας.',
      ],
    },
    {
      heading: 'Τι κρατάμε',
      paragraphs: [
        'Για εσάς: email, επωνυμία, ΑΦΜ, email απάντησης, γλώσσα, υπόλοιπο SMS και τα διαπιστευτήρια των υπηρεσιών που συνδέετε — τα τελευταία κρυπτογραφημένα.',
        'Για τους πελάτες σας: επωνυμία, ΑΦΜ, email, τηλέφωνο, σημειώσεις, τα παραστατικά με ποσά και ημερομηνίες, το ιστορικό των μηνυμάτων που στάλθηκαν, την κατάσταση πληρωμής και τα αρχεία τιμολογίων που ανεβάζετε.',
        'Καταγράφουμε επίσης δύο γεγονότα γύρω από τον σύνδεσμο πληρωμής: ότι ανοίχτηκε και ότι ξεκίνησε πληρωμή. Χωρίς διεύθυνση IP, χωρίς user agent, χωρίς cookie, χωρίς παραπομπή. Η γραμμή λέει «αυτός ο σύνδεσμος χρησιμοποιήθηκε, από αυτό το κανάλι, αυτή την ώρα» και τίποτα άλλο.',
        'Στις σελίδες πληρωμής δεν υπάρχει κανένας ιχνηλάτης τρίτου. Ο οφειλέτης δεν είναι κοινό μας.',
      ],
    },
    {
      heading: 'Πού βρίσκονται',
      paragraphs: [
        'Η βάση δεδομένων και τα αρχεία φιλοξενούνται στη Φρανκφούρτη (eu-central-1), εντός ΕΕ. Η εφαρμογή τρέχει σε υποδομή Vercel.',
        'Τα αρχεία τιμολογίων που ανεβάζετε αποθηκεύονται σε ιδιωτικό χώρο· δεν υπάρχει δημόσια διεύθυνση για αυτά και η πρόσβαση γίνεται μόνο με βραχύβιους υπογεγραμμένους συνδέσμους.',
      ],
    },
    {
      heading: 'Ποιοι άλλοι εμπλέκονται',
      paragraphs: [
        'Supabase — βάση δεδομένων, ταυτοποίηση και αποθήκευση αρχείων.',
        'Vercel — φιλοξενία της εφαρμογής.',
        'Resend — αποστολή email. Brevo — αποστολή SMS.',
        'Stripe, Viva.com, Revolut — πληρωμές με κάρτα. Τα στοιχεία της κάρτας δεν περνούν ποτέ από το lefta.app και τα χρήματα πηγαίνουν απευθείας στον δικό σας λογαριασμό στον πάροχο. Δεν μεσολαβούμε στα χρήματά σας.',
        'Enable Banking — ανάγνωση κινήσεων τραπεζικού λογαριασμού, εφόσον το συνδέσετε.',
        'ΑΑΔΕ (myDATA) και Elorus — άντληση των δικών σας παραστατικών, εφόσον τα συνδέσετε.',
      ],
    },
    {
      heading: 'Με ποια νομική βάση',
      paragraphs: [
        'Για τον λογαριασμό σας: η εκτέλεση της σύμβασης μαζί μας.',
        'Για τους οφειλέτες σας: το έννομο συμφέρον σας να εισπράξετε μια πραγματική οφειλή, άρθρο 6 παρ. 1 στ) ΓΚΠΔ. Η στάθμιση είναι δική σας ευθύνη και προϋποθέτει ότι η οφειλή υπάρχει και ότι τα στοιχεία επικοινωνίας τα αποκτήσατε νόμιμα.',
      ],
    },
    {
      heading: 'Για πόσο',
      paragraphs: [
        'Όσο διατηρείτε τον λογαριασμό σας. Μπορείτε να διαγράψετε ένα παραστατικό ή έναν πελάτη ανά πάσα στιγμή· η διαγραφή είναι οριστική και παρασύρει ό,τι κρέμεται από αυτά, όπως δηλώνεται στην οθόνη επιβεβαίωσης.',
        'Με τη διαγραφή του λογαριασμού διαγράφονται και τα δεδομένα των πελατών σας που φιλοξενούσαμε για λογαριασμό σας.',
      ],
    },
    {
      heading: 'Δικαιώματα',
      paragraphs: [
        'Πρόσβαση, διόρθωση, διαγραφή, περιορισμός, φορητότητα και εναντίωση.',
        LEGAL_ENTITY.email
          ? `Αν είστε πελάτης του lefta.app, απευθυνθείτε σε ${LEGAL_ENTITY.email}.`
          : `Αν είστε πελάτης του lefta.app, απευθυνθείτε στην ${LEGAL_ENTITY.name} με τα στοιχεία που αναφέρονται στο τέλος του παρόντος.`,
        'Αν λάβατε υπενθύμιση από κάποιον που χρησιμοποιεί το lefta.app, υπεύθυνος επεξεργασίας είναι εκείνος και όχι εμείς. Απαντήστε στο μήνυμα ή επικοινωνήστε μαζί του απευθείας· εμείς μπορούμε μόνο να προωθήσουμε το αίτημα.',
        // The controller is established in Poland, so its own supervisory
        // authority is the Polish one. That does not narrow anybody's rights:
        // a complaint may always be lodged where the person lives or works.
        'Η εταιρεία είναι εγκατεστημένη στην Πολωνία και εποπτική αρχή της είναι ο Πρόεδρος της Αρχής Προστασίας Δεδομένων Προσωπικού Χαρακτήρα της Πολωνίας (UODO). Μπορείτε να υποβάλετε καταγγελία είτε στην αρχή της χώρας σας — στην Ελλάδα, στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα — είτε στην UODO.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'Ένα cookie συνεδρίας, ώστε να παραμένετε συνδεδεμένοι. Καμία υπηρεσία αναλυτικών, κανένα διαφημιστικό cookie, τίποτα στις σελίδες πληρωμής.',
      ],
    },
    {
      heading: 'Επικοινωνία',
      paragraphs: [
        entityIdentity('el'),
      ],
    },
  ],
};

const TERMS_EL: LegalDocument = {
  title: 'Όροι χρήσης',
  summary: 'Τι κάνει το lefta.app, τι δεν κάνει, και ποιος ευθύνεται για τι.',
  updated: '2026-09-12',
  sections: [
    {
      heading: 'Τι είναι η υπηρεσία',
      paragraphs: [
        'Το lefta.app παρακολουθεί τα ανεξόφλητα παραστατικά σας, στέλνει υπενθυμίσεις για λογαριασμό σας με email και SMS, και δίνει στον πελάτη σας σύνδεσμο άμεσης πληρωμής.',
        'Απευθύνεται σε επιχειρήσεις. Δεν προορίζεται για ιδιωτική, μη επαγγελματική χρήση.',
      ],
    },
    {
      heading: 'Τι δεν είναι',
      paragraphs: [
        'Δεν είναι εταιρεία ενημέρωσης οφειλετών ούτε δικηγορικό γραφείο. Δεν παρέχουμε νομικές ή φορολογικές συμβουλές.',
        'Δεν εγγυόμαστε ότι θα εισπράξετε. Μια υπενθύμιση που παραδόθηκε δεν είναι πληρωμή.',
        'Δεν μεσολαβούμε στα χρήματά σας. Οι πληρωμές πηγαίνουν απευθείας στον δικό σας λογαριασμό στον πάροχο πληρωμών· δεν τα κρατάμε, δεν τα προωθούμε και δεν τα αγγίζουμε.',
        'Δεν είμαστε συμβαλλόμενο μέρος στην οφειλή μεταξύ εσάς και του πελάτη σας.',
      ],
    },
    {
      heading: 'Τι αναλαμβάνετε εσείς',
      paragraphs: [
        'Ότι η οφειλή είναι πραγματική και τα ποσά σωστά.',
        'Ότι έχετε νόμιμα τα στοιχεία επικοινωνίας που ανεβάζετε και ότι δικαιούστε να τα χρησιμοποιήσετε για τον σκοπό αυτό.',
        'Ότι το περιεχόμενο που στέλνετε είναι σύννομο. Τα κείμενα των υπενθυμίσεων είναι επεξεργάσιμα από εσάς και δική σας ευθύνη· η απειλή, η παραπλάνηση και η όχληση εκτός των επιτρεπτών ορίων απαγορεύονται.',
        'Ότι τηρείτε τις υποχρεώσεις σας ως υπεύθυνος επεξεργασίας απέναντι στους πελάτες σας.',
      ],
    },
    {
      heading: 'Όρια αποστολών και κόστη',
      paragraphs: [
        'Η υπηρεσία δεν στέλνει σε έναν πελάτη περισσότερες από μία φορά την ίδια ημέρα, ανεξάρτητα από το πόσα παραστατικά του εκκρεμούν. Το όριο είναι σκόπιμο και δεν απενεργοποιείται.',
        'Τα SMS χρεώνονται με μονάδες που αγοράζετε εκ των προτέρων. Τα ελληνικά μηνύματα κωδικοποιούνται σε UCS-2, δηλαδή 70 χαρακτήρες ανά τμήμα.',
      ],
    },
    {
      heading: 'Διαθεσιμότητα',
      paragraphs: [
        'Η υπηρεσία παρέχεται ως έχει, χωρίς εγγύηση αδιάλειπτης λειτουργίας. Εξαρτάται από τρίτους παρόχους — φιλοξενία, email, SMS, πληρωμές, τράπεζες — και μια διακοπή σε αυτούς μπορεί να μας σταματήσει.',
        'Μπορούμε να αλλάξουμε ή να αποσύρουμε λειτουργίες. Ουσιώδεις αλλαγές ανακοινώνονται εκ των προτέρων.',
      ],
    },
    {
      heading: 'Ευθύνη',
      paragraphs: [
        'Δεν ευθυνόμαστε για διαφυγόντα κέρδη, για οφειλές που δεν εισπράχθηκαν, ούτε για τις συνέπειες μηνυμάτων που εσείς συνθέσατε και στείλατε.',
        'Η συνολική μας ευθύνη περιορίζεται στα ποσά που μας καταβάλατε τους δώδεκα μήνες πριν από το γεγονός.',
        'Τίποτα από τα παραπάνω δεν περιορίζει ευθύνη που κατά νόμο δεν περιορίζεται.',
      ],
    },
    {
      heading: 'Λήξη',
      paragraphs: [
        'Μπορείτε να σταματήσετε όποτε θέλετε. Μπορούμε να διακόψουμε λογαριασμό που χρησιμοποιείται παράνομα ή καταχρηστικά.',
        'Με τη λήξη διαγράφονται τα δεδομένα σας και τα δεδομένα των πελατών σας που φιλοξενούσαμε για λογαριασμό σας.',
      ],
    },
    {
      heading: 'Εφαρμοστέο δίκαιο',
      paragraphs: [
        // Written when the operator was assumed to be Greek. A Polish company
        // may lawfully choose Greek law for business customers (Rome I, Art.
        // 3), so this stays as it is rather than being flipped on a guess —
        // but it is now a decision, and a decision with a cost attached.
        // Flagged in docs/handover.md for a lawyer, not changed here.
        'Ελληνικό δίκαιο. Αρμόδια τα δικαστήρια των Αθηνών.',
        entityIdentity('el'),
      ],
    },
  ],
};

const PRIVACY_EN: LegalDocument = {
  title: 'Privacy notice',
  summary: 'What lefta.app processes, on whose behalf, on what basis, and for how long.',
  updated: '2026-09-12',
  sections: [
    {
      heading: 'Two roles, not one',
      paragraphs: [
        `For your own account data — email, company name, VAT number, settings — ${LEGAL_ENTITY.name} is the controller.`,
        'For your customers’ data, which you upload or sync, lefta.app is a processor acting only on your instructions. You remain the controller: you decide who is chased, with what, and when.',
        'The distinction is not a formality. A debtor who receives a reminder never signed up here and never agreed to anything with us.',
      ],
    },
    {
      heading: 'What is held',
      paragraphs: [
        'About you: email, company name, VAT number, reply-to address, language, SMS balance, and the credentials of the services you connect — those encrypted.',
        'About your customers: name, VAT number, email, phone, notes, their invoices with amounts and dates, the history of messages sent to them, payment status, and any invoice documents you upload.',
        'Two events are recorded around the payment link: that it was opened, and that a payment was started. No IP address, no user agent, no cookie, no referrer. The row says "this link was used, from this channel, at this time" and nothing more.',
        'There is no third-party tracker on the payment pages. The debtor is not an audience.',
      ],
    },
    {
      heading: 'Where it lives',
      paragraphs: [
        'The database and the files are hosted in Frankfurt (eu-central-1), inside the EU. The application runs on Vercel.',
        'Uploaded invoice documents sit in a private store. They have no public address, and access is only ever through short-lived signed links.',
      ],
    },
    {
      heading: 'Who else is involved',
      paragraphs: [
        'Supabase — database, authentication and file storage.',
        'Vercel — application hosting.',
        'Resend — email delivery. Brevo — SMS delivery.',
        'Stripe, Viva.com, Revolut — card payments. Card details never pass through lefta.app, and the money goes straight to your own account with the provider. We do not sit between you and your money.',
        'Enable Banking — reading bank account activity, if you connect it.',
        'AADE (myDATA) and Elorus — pulling in your own invoices, if you connect them.',
      ],
    },
    {
      heading: 'On what legal basis',
      paragraphs: [
        'For your account: performance of our contract with you.',
        'For your debtors: your legitimate interest in recovering a genuine debt, Article 6(1)(f) GDPR. That balancing is yours to make, and it assumes the debt exists and that you obtained the contact details lawfully.',
      ],
    },
    {
      heading: 'For how long',
      paragraphs: [
        'For as long as you keep your account. You can delete an invoice or a customer at any time; deletion is permanent and takes with it what hangs off them, as the confirmation screen states before you press it.',
        'Deleting your account deletes the customer data we held on your behalf.',
      ],
    },
    {
      heading: 'Rights',
      paragraphs: [
        'Access, rectification, erasure, restriction, portability and objection.',
        LEGAL_ENTITY.email
          ? `If you are a lefta.app customer, write to ${LEGAL_ENTITY.email}.`
          : `If you are a lefta.app customer, write to ${LEGAL_ENTITY.name} using the details at the end of this notice.`,
        'If you received a reminder from someone using lefta.app, the controller is them, not us. Reply to the message or contact them directly; we can only pass a request on.',
        'The company is established in Poland, so its supervisory authority is the President of the Polish Data Protection Authority (UODO). That narrows nothing: you may lodge a complaint either with the authority of your own country — in Greece, the Hellenic Data Protection Authority — or with UODO.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'One session cookie, so that you stay signed in. No analytics, no advertising cookies, nothing at all on the payment pages.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [
        entityIdentity('en'),
      ],
    },
  ],
};

const TERMS_EN: LegalDocument = {
  title: 'Terms of use',
  summary: 'What lefta.app does, what it does not do, and who is answerable for what.',
  updated: '2026-09-12',
  sections: [
    {
      heading: 'What the service is',
      paragraphs: [
        'lefta.app tracks your unpaid invoices, sends reminders on your behalf by email and SMS, and gives your customer a link to pay straight away.',
        'It is for businesses. It is not intended for private, non-professional use.',
      ],
    },
    {
      heading: 'What it is not',
      paragraphs: [
        'Not a debt collection agency and not a law firm. We give no legal or tax advice.',
        'No guarantee that you will be paid. A reminder that was delivered is not a payment.',
        'Not an intermediary for your money. Payments go directly into your own account with the payment provider; we do not hold them, forward them, or touch them.',
        'Not a party to the debt between you and your customer.',
      ],
    },
    {
      heading: 'What you undertake',
      paragraphs: [
        'That the debt is genuine and the amounts are right.',
        'That you hold the contact details you upload lawfully, and may use them for this purpose.',
        'That what you send is lawful. The reminder wording is editable by you and is your responsibility: threats, misleading claims and harassment beyond what the law permits are not allowed.',
        'That you meet your own obligations as controller towards your customers.',
      ],
    },
    {
      heading: 'Sending limits and costs',
      paragraphs: [
        'The service will not contact one customer more than once on the same day, however many invoices of theirs are outstanding. The limit is deliberate and cannot be switched off.',
        'SMS is charged against credits bought in advance. Greek messages are encoded as UCS-2, which is 70 characters per segment.',
      ],
    },
    {
      heading: 'Availability',
      paragraphs: [
        'The service is provided as is, with no guarantee of uninterrupted operation. It depends on third parties — hosting, email, SMS, payments, banks — and an outage at one of them can stop us.',
        'We may change or withdraw features. Material changes are announced in advance.',
      ],
    },
    {
      heading: 'Liability',
      paragraphs: [
        'We are not liable for lost profit, for debts that went uncollected, or for the consequences of messages you composed and sent.',
        'Our total liability is limited to what you paid us in the twelve months before the event.',
        'None of the above limits liability that cannot be limited by law.',
      ],
    },
    {
      heading: 'Ending it',
      paragraphs: [
        'You can stop whenever you like. We may suspend an account being used unlawfully or abusively.',
        'On termination your data, and the customer data we held on your behalf, are deleted.',
      ],
    },
    {
      heading: 'Governing law',
      paragraphs: [
        // See the note on the Greek version: a choice now, not a default.
        'Greek law. The courts of Athens have jurisdiction.',
        entityIdentity('en'),
      ],
    },
  ],
};

/** Both documents, in both languages. */
export const LEGAL: Record<Locale, { privacy: LegalDocument; terms: LegalDocument }> = {
  el: { privacy: PRIVACY_EL, terms: TERMS_EL },
  en: { privacy: PRIVACY_EN, terms: TERMS_EN },
};
