/**
 * Portal copy, in Greek and English.
 *
 * This covers the *interface*. It deliberately does not cover reminder copy:
 * those messages are addressed to the tenant's own customers, and their wording
 * belongs to the tenant, in the template editor.
 *
 * `en` is typed as `typeof el`, so a key added to one language and forgotten in
 * the other is a compile error rather than a Greek string surfacing in the
 * English interface.
 */

export const LOCALES = ['el', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

const el = {
  /** Passed to toLocaleString for dates and times. */
  dateTimeTag: 'el-GR',
  languageName: 'Ελληνικά',

  common: {
    save: 'Αποθήκευση',
    saving: 'Αποθήκευση…',
    cancel: 'Άκυρο',
    close: 'Κλείσιμο',
    edit: 'Επεξεργασία',
    signOut: 'Έξοδος',
    unknownCustomer: 'Άγνωστος πελάτης',
    email: 'Email',
    sms: 'SMS',
  },

  nav: {
    dashboard: 'Επισκόπηση',
    invoices: 'Παραστατικά',
    debtors: 'Πελάτες',
    logs: 'Ιστορικό επικοινωνίας',
    settings: 'Ρυθμίσεις',
    smsCredits: 'SMS',
  },

  auth: {
    signInTitle: 'Σύνδεση',
    registerTitle: 'Εγγραφή',
    noAccount: 'Δεν έχετε λογαριασμό;',
    haveAccount: 'Έχετε ήδη λογαριασμό;',
    signInLink: 'Σύνδεση',
    registerLink: 'Δημιουργία λογαριασμού',
  },

  dashboard: {
    title: 'Επισκόπηση',
    lastSync: (when: string) => `Τελευταίος συγχρονισμός myDATA: ${when}`,
    neverSynced: 'Δεν έχει γίνει ακόμη συγχρονισμός με το myDATA.',
    automationOff: 'Η αυτοματοποίηση είναι απενεργοποιημένη. Δεν θα σταλεί καμία υπενθύμιση.',
    settingsLink: 'Ρυθμίσεις',
    unreachable: (count: number) =>
      `${count} ${count === 1 ? 'πελάτης' : 'πελάτες'} με ανεξόφλητα παραστατικά δεν έχουν email ή τηλέφωνο — δεν μπορούν να λάβουν υπενθύμιση.`,
    fixContacts: 'Συμπλήρωση στοιχείων',
    outstanding: 'Ανοιχτό υπόλοιπο',
    outstandingHint: (count: number) => `${count} ενεργά παραστατικά`,
    overdue: 'Ληξιπρόθεσμα',
    overdueHint: (count: number) => `${count} παραστατικά`,
    collected: 'Εισπράχθηκαν',
    collectedHint: 'Μέσω lefta.app',
    smsBalance: 'Υπόλοιπο SMS',
    smsLow: 'Χαμηλό υπόλοιπο',
    smsOk: 'Διαθέσιμα μηνύματα',
    openBalances: 'Πελάτες με ανοιχτά υπόλοιπα',
    openBalancesHint: 'Η κατάσταση αφορά το παλαιότερο ανεξόφλητο παραστατικό κάθε πελάτη.',
    allCustomers: 'Όλοι οι πελάτες',
    emptyTitle: 'Κανένα ανοιχτό υπόλοιπο',
    emptyBody: 'Μόλις συγχρονίσετε τα παραστατικά σας από το myDATA, θα εμφανιστούν εδώ.',
    colCustomer: 'Πελάτης',
    colInvoices: 'Παραστατικά',
    colBalance: 'Υπόλοιπο',
    colOldestDue: 'Λήξη (παλαιότερο)',
    colWorkflow: 'Κατάσταση ροής',
    colLastContact: 'Τελευταία επαφή',
  },

  invoices: {
    title: 'Παραστατικά',
    subtitle: 'Συγχρονισμένα από το myDATA ή καταχωρημένα χειροκίνητα.',
    filterOpen: 'Ανοιχτά',
    filterPaid: 'Εξοφλημένα',
    filterAll: 'Όλα',
    count: (n: number) => `${n} παραστατικά`,
    emptyTitle: 'Κανένα παραστατικό',
    emptyBody:
      'Συγχρονίστε με το myDATA από την επισκόπηση, ή καταχωρήστε ένα παραστατικό χειροκίνητα.',
    colInvoice: 'Παραστατικό',
    colCustomer: 'Πελάτης',
    colAmount: 'Ποσό',
    colDue: 'Λήξη',
    colStatus: 'Κατάσταση',
    colActions: 'Ενέργειες',
    manualSource: 'Χειροκίνητο',
    colIssue: 'Έκδοση',
    markLabel: 'MARK',
    numberLabel: 'Αρ. παραστατικού',
    noNumber: 'Χωρίς αριθμό',
    markPaid: 'Εξοφλήθηκε',
    markPaidHint: 'Καταχώρηση εξόφλησης εκτός πλατφόρμας (π.χ. τραπεζικό έμβασμα)',
    payLink: 'Σύνδεσμος πληρωμής',
    payLinkCopied: 'Αντιγράφηκε',
    remind: 'Υπενθύμιση',
    remindHint: 'Προεπισκόπηση και αποστολή υπενθύμισης',
    newManual: 'Χειροκίνητο παραστατικό',
    limitsOffTitle: 'Δοκιμαστική λειτουργία — το ημερήσιο όριο είναι ανενεργό.',
    limitsOffBody:
      'Οι χειροκίνητες υπενθυμίσεις στέλνονται χωρίς περιορισμό και δεν καταγράφονται ως επαφές. Η αυτόματη ροή δεν επηρεάζεται. Αφαιρέστε το UNSAFE_DISABLE_CONTACT_LIMITS πριν σταλεί οτιδήποτε σε πραγματικό πελάτη.',
  },

  reminder: {
    title: 'Υπενθύμιση πληρωμής',
    invoiceLabel: (label: string) => `Παραστατικό ${label}`,
    templateLabel: 'Κείμενο',
    note: 'Επιλέγετε μόνο το κείμενο. Η χειροκίνητη αποστολή δεν καταναλώνει βήμα της αυτόματης ροής — το βήμα 2 θα σταλεί κανονικά αργότερα.',
    loading: 'Φόρτωση προεπισκόπησης…',
    noChannel: 'Κανένα διαθέσιμο κανάλι',
    smsSegments: (n: number) => `SMS — ${n} τμήμα(τα)`,
    subjectLabel: 'Θέμα',
    previewFailed: 'Δεν ήταν δυνατή η προεπισκόπηση.',
    send: 'Αποστολή τώρα',
    sending: 'Αποστολή…',
  },

  debtors: {
    title: 'Πελάτες',
    subtitle:
      'Οι πελάτες δημιουργούνται αυτόματα από το myDATA. Συμπληρώστε email και κινητό ώστε να μπορούν να λαμβάνουν υπενθυμίσεις.',
    count: (n: number) => `${n} πελάτες`,
    emptyTitle: 'Κανένας πελάτης ακόμη',
    emptyBody:
      'Συγχρονίστε τα παραστατικά σας από το myDATA ή προσθέστε έναν πελάτη χειροκίνητα.',
    vat: 'ΑΦΜ',
    nameLabel: 'Επωνυμία',
    nameMissing: 'Χωρίς επωνυμία',
    nameMissingHint: 'Το myDATA δεν έστειλε επωνυμία — συμπληρώστε την.',
    emailLabel: 'Email',
    phoneLabel: 'Τηλέφωνο',
    notSet: '—',
    outstandingLabel: 'Ανοιχτό υπόλοιπο',
    muted: 'σε παύση',
    noContact: 'χωρίς στοιχεία επικοινωνίας',
    noEmail: '— χωρίς email',
    noPhone: '— χωρίς τηλέφωνο',
    openCount: (n: number) => `${n} ανοιχτά`,
    mute: 'Παύση',
    unmute: 'Ενεργοποίηση',
    backToList: '← Όλοι οι πελάτες',
    invoicesTitle: 'Παραστατικά πελάτη',
    noInvoicesTitle: 'Κανένα παραστατικό',
    noInvoicesBody: 'Δεν υπάρχει ακόμη παραστατικό για αυτόν τον πελάτη.',
    notFound: 'Ο πελάτης δεν βρέθηκε.',
    paidTotal: 'Εξοφλημένα',
    notesLabel: 'Σημειώσεις',
  },

  logs: {
    title: 'Ιστορικό επικοινωνίας',
    subtitle: 'Πλήρες, μη τροποποιήσιμο αρχείο κάθε μηνύματος που στάλθηκε για λογαριασμό σας.',
    cardTitle: 'Τελευταία 200 μηνύματα',
    cardSubtitle: 'Κάθε πελάτης λαμβάνει το πολύ μία επαφή ανά ημέρα.',
    emptyTitle: 'Δεν έχει σταλεί κανένα μήνυμα',
    emptyBody:
      'Μόλις υπάρξει παραστατικό που πλησιάζει ή ξεπερνά τη λήξη του, η ροή θα ξεκινήσει αυτόματα.',
    statusSent: 'Στάλθηκε',
    statusFailed: 'Απέτυχε',
    statusSkipped: 'Παραλείφθηκε',
  },

  settings: {
    title: 'Ρυθμίσεις',
    subtitle: 'Στοιχεία επιχείρησης, myDATA, πληρωμές και SMS.',
    business: 'Στοιχεία επιχείρησης',
    language: 'Γλώσσα',
    languageHint: 'Αφορά μόνο το περιβάλλον διαχείρισης, όχι τα μηνύματα προς τους πελάτες σας.',
    mydata: 'Σύνδεση myDATA (ΑΑΔΕ)',
    mydataHint:
      'Το Subscription Key αποθηκεύεται κρυπτογραφημένο (AES-256-GCM) και δεν επιστρέφεται ποτέ στον browser.',
    connected: 'Συνδεδεμένο',
    notConnected: 'Μη συνδεδεμένο',
    stripe: 'Είσπραξη με κάρτα (Stripe)',
    stripeHint:
      'Οι πληρωμές πηγαίνουν απευθείας στον δικό σας λογαριασμό. Το lefta.app δεν μεσολαβεί στη ροή χρημάτων.',
    stripeActive: 'Ενεργό',
    stripePending: 'Σε εκκρεμότητα',
    smsTitle: 'Υπόλοιπο SMS',
    smsHint: 'Ένα SMS καταναλώνεται ανά απεσταλμένο μήνυμα. Τα email είναι απεριόριστα.',
    smsAvailable: (n: number) => `${n} διαθέσιμα`,
    templatesTitle: 'Κείμενα μηνυμάτων',
    templatesHint:
      'Το περιεχόμενο είναι δικό σας. Το πλαίσιο του email (κουμπί πληρωμής και υποσέλιδο πλατφόρμας) παραμένει σταθερό.',
    flowTitle: 'Ροή υπενθυμίσεων',
    flowHint:
      'Ο χρονισμός είναι σταθερός και μη παραμετροποιήσιμος — παραμετροποιήσιμο είναι μόνο το κείμενο. Το lefta.app λειτουργεί αποκλειστικά ως πάροχος λογισμικού.',
    beforeDue: (n: number) => `${n} ημέρες πριν τη λήξη`,
    afterDue: (n: number) => `${n} ημέρες μετά τη λήξη`,
    rateLimitLabel: 'Όριο συχνότητας:',
    rateLimitBody:
      'κάθε πελάτης λαμβάνει το πολύ μία επαφή ανά ημερολογιακή ημέρα, ανεξάρτητα από το πλήθος των ανεξόφλητων παραστατικών του. Το όριο επιβάλλεται στη βάση δεδομένων.',
    autoStopLabel: 'Αυτόματη διακοπή:',
    autoStopBody:
      'μόλις ένα παραστατικό σημανθεί ως εξοφλημένο, η ροή σταματά αμέσως για αυτό.',
    saved: 'Οι ρυθμίσεις αποθηκεύτηκαν.',
  },

  steps: {
    longPreDue: '1 — Υπενθύμιση πριν τη λήξη',
    longOverdue2: '2 — Ληξιπρόθεσμο (email + SMS)',
    longOverdue10: '3 — Τελική υπενθύμιση (email + SMS)',
    shortPreDue: 'Βήμα 1',
    shortOverdue2: 'Βήμα 2',
    shortOverdue10: 'Βήμα 3',
  },

  sync: {
    connect: 'Σύνδεση με myDATA',
    run: 'Συγχρονισμός myDATA',
    running: 'Συγχρονισμός…',
    failed: 'Ο συγχρονισμός απέτυχε.',
    result: (fetched: number, invoices: number, debtors: number) =>
      `Ελήφθησαν ${fetched} παραστατικά · ${invoices} νέα · ${debtors} νέοι πελάτες.`,
    more: 'Υπάρχουν κι άλλα — πατήστε ξανά για συνέχεια.',
  },

  invoiceForm: {
    heading: 'Νέο παραστατικό',
    customer: 'Πελάτης',
    choose: 'Επιλέξτε…',
    amount: 'Ποσό (€)',
    series: 'Σειρά',
    number: 'Αριθμός',
    issueDate: 'Ημ. έκδοσης',
    dueDate: 'Ημ. λήξης',
  },

  templates: {
    custom: 'Προσαρμοσμένο',
    default: 'Προεπιλογή',
    subject: 'Θέμα',
    body: 'Κείμενο',
    smsHint: 'Τα ελληνικά SMS χρεώνονται ανά 70 χαρακτήρες. Κρατήστε το σύντομο.',
    reset: 'Επαναφορά προεπιλογής',
    resetting: 'Επαναφορά…',
    placeholders: 'Διαθέσιμες μεταβλητές — αντιγράψτε τις μέσα στο κείμενο:',
  },

  workflow: {
    paid: 'Εξοφλήθηκε',
    cancelled: 'Ακυρώθηκε',
    writtenOff: 'Διαγράφηκε',
    stepSent: (step: string) => `${step} στάλθηκε`,
    stepSentFinal: (step: string) => `${step} στάλθηκε (τελικό)`,
    stepPending: (step: string) => `${step} σε αναμονή`,
    daysOverdue: (n: number) => `${n} ημέρες σε καθυστέρηση`,
    dueInDays: (n: number) => `Λήγει σε ${n} ημέρες`,
  },
  // Deliberately not `as const`: that would make every string its own literal
  // type and force the English dictionary to repeat the Greek words verbatim.
  // Parity is meant to be on keys, not values.
};

const en: typeof el = {
  dateTimeTag: 'en-GB',
  languageName: 'English',

  common: {
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    close: 'Close',
    edit: 'Edit',
    signOut: 'Sign out',
    unknownCustomer: 'Unknown customer',
    email: 'Email',
    sms: 'SMS',
  },

  nav: {
    dashboard: 'Overview',
    invoices: 'Invoices',
    debtors: 'Customers',
    logs: 'Message history',
    settings: 'Settings',
    smsCredits: 'SMS',
  },

  auth: {
    signInTitle: 'Sign in',
    registerTitle: 'Create account',
    noAccount: 'No account yet?',
    haveAccount: 'Already have an account?',
    signInLink: 'Sign in',
    registerLink: 'Create an account',
  },

  dashboard: {
    title: 'Overview',
    lastSync: (when: string) => `Last myDATA sync: ${when}`,
    neverSynced: 'No myDATA sync has run yet.',
    automationOff: 'Automation is switched off. No reminders will be sent.',
    settingsLink: 'Settings',
    unreachable: (count: number) =>
      `${count} ${count === 1 ? 'customer' : 'customers'} with unpaid invoices have neither an email nor a phone number — they cannot be reminded.`,
    fixContacts: 'Add contact details',
    outstanding: 'Outstanding',
    outstandingHint: (count: number) => `${count} open invoices`,
    overdue: 'Overdue',
    overdueHint: (count: number) => `${count} invoices`,
    collected: 'Collected',
    collectedHint: 'Through lefta.app',
    smsBalance: 'SMS balance',
    smsLow: 'Running low',
    smsOk: 'Messages available',
    openBalances: 'Customers with open balances',
    openBalancesHint: "Status refers to each customer's oldest unpaid invoice.",
    allCustomers: 'All customers',
    emptyTitle: 'No open balances',
    emptyBody: 'Once you sync your invoices from myDATA they will appear here.',
    colCustomer: 'Customer',
    colInvoices: 'Invoices',
    colBalance: 'Balance',
    colOldestDue: 'Due (oldest)',
    colWorkflow: 'Workflow',
    colLastContact: 'Last contact',
  },

  invoices: {
    title: 'Invoices',
    subtitle: 'Synced from myDATA, or entered by hand.',
    filterOpen: 'Open',
    filterPaid: 'Paid',
    filterAll: 'All',
    count: (n: number) => `${n} invoices`,
    emptyTitle: 'No invoices',
    emptyBody: 'Sync with myDATA from the overview, or add an invoice by hand.',
    colInvoice: 'Invoice',
    colCustomer: 'Customer',
    colAmount: 'Amount',
    colDue: 'Due',
    colStatus: 'Status',
    colActions: 'Actions',
    manualSource: 'Manual',
    colIssue: 'Issued',
    markLabel: 'MARK',
    numberLabel: 'Document no.',
    noNumber: 'No number',
    markPaid: 'Mark paid',
    markPaidHint: 'Record a payment made outside the platform (e.g. bank transfer)',
    payLink: 'Payment link',
    payLinkCopied: 'Copied',
    remind: 'Remind',
    remindHint: 'Preview and send a reminder',
    newManual: 'Manual invoice',
    limitsOffTitle: 'Testing mode — the daily contact limit is off.',
    limitsOffBody:
      'Manual reminders send without any limit and are not recorded as contacts. The automated flow is unaffected. Remove UNSAFE_DISABLE_CONTACT_LIMITS before anything goes to a real customer.',
  },

  reminder: {
    title: 'Payment reminder',
    invoiceLabel: (label: string) => `Invoice ${label}`,
    templateLabel: 'Wording',
    note: 'This picks the wording only. A manual send does not consume a step of the automated flow — step 2 will still go out on schedule.',
    loading: 'Loading preview…',
    noChannel: 'No channel available',
    smsSegments: (n: number) => `SMS — ${n} segment(s)`,
    subjectLabel: 'Subject',
    previewFailed: 'Could not build the preview.',
    send: 'Send now',
    sending: 'Sending…',
  },

  debtors: {
    title: 'Customers',
    subtitle:
      'Customers are created automatically from myDATA. Fill in an email and mobile so they can receive reminders.',
    count: (n: number) => `${n} customers`,
    emptyTitle: 'No customers yet',
    emptyBody: 'Sync your invoices from myDATA, or add a customer by hand.',
    vat: 'VAT',
    nameLabel: 'Name',
    nameMissing: 'No name',
    nameMissingHint: 'myDATA sent no name — please fill it in.',
    emailLabel: 'Email',
    phoneLabel: 'Phone',
    notSet: '—',
    outstandingLabel: 'Outstanding',
    muted: 'muted',
    noContact: 'no contact details',
    noEmail: '— no email',
    noPhone: '— no phone',
    openCount: (n: number) => `${n} open`,
    mute: 'Mute',
    unmute: 'Unmute',
    backToList: '← All customers',
    invoicesTitle: 'Customer documents',
    noInvoicesTitle: 'No documents',
    noInvoicesBody: 'There is no document for this customer yet.',
    notFound: 'Customer not found.',
    paidTotal: 'Paid',
    notesLabel: 'Notes',
  },

  logs: {
    title: 'Message history',
    subtitle: 'A complete, unalterable record of every message sent on your behalf.',
    cardTitle: 'Last 200 messages',
    cardSubtitle: 'Each customer receives at most one contact per day.',
    emptyTitle: 'No messages sent yet',
    emptyBody:
      'As soon as an invoice approaches or passes its due date, the flow starts automatically.',
    statusSent: 'Sent',
    statusFailed: 'Failed',
    statusSkipped: 'Skipped',
  },

  settings: {
    title: 'Settings',
    subtitle: 'Business details, myDATA, payments and SMS.',
    business: 'Business details',
    language: 'Language',
    languageHint: 'Affects the admin interface only, not the messages your customers receive.',
    mydata: 'myDATA connection (AADE)',
    mydataHint:
      'The subscription key is stored encrypted (AES-256-GCM) and is never returned to the browser.',
    connected: 'Connected',
    notConnected: 'Not connected',
    stripe: 'Card payments (Stripe)',
    stripeHint:
      'Payments go straight to your own account. lefta.app does not sit in the flow of money.',
    stripeActive: 'Active',
    stripePending: 'Pending',
    smsTitle: 'SMS balance',
    smsHint: 'One credit per SMS sent. Emails are unlimited.',
    smsAvailable: (n: number) => `${n} available`,
    templatesTitle: 'Message copy',
    templatesHint:
      'The wording is yours. The email frame — payment button and platform footer — stays fixed.',
    flowTitle: 'Reminder flow',
    flowHint:
      'The timing is fixed and not configurable — only the wording is. lefta.app operates strictly as a software provider.',
    beforeDue: (n: number) => `${n} days before the due date`,
    afterDue: (n: number) => `${n} days after the due date`,
    rateLimitLabel: 'Rate limit:',
    rateLimitBody:
      'each customer receives at most one contact per calendar day, however many unpaid invoices they have. The limit is enforced in the database.',
    autoStopLabel: 'Auto-stop:',
    autoStopBody: 'the moment an invoice is marked paid, its flow stops immediately.',
    saved: 'Settings saved.',
  },

  steps: {
    longPreDue: '1 — Reminder before the due date',
    longOverdue2: '2 — Overdue (email + SMS)',
    longOverdue10: '3 — Final reminder (email + SMS)',
    shortPreDue: 'Step 1',
    shortOverdue2: 'Step 2',
    shortOverdue10: 'Step 3',
  },

  sync: {
    connect: 'Connect myDATA',
    run: 'Sync myDATA',
    running: 'Syncing…',
    failed: 'The sync failed.',
    result: (fetched: number, invoices: number, debtors: number) =>
      `${fetched} documents fetched · ${invoices} new · ${debtors} new customers.`,
    more: 'More remain — press again to continue.',
  },

  invoiceForm: {
    heading: 'New invoice',
    customer: 'Customer',
    choose: 'Choose…',
    amount: 'Amount (€)',
    series: 'Series',
    number: 'Number',
    issueDate: 'Issue date',
    dueDate: 'Due date',
  },

  templates: {
    custom: 'Customised',
    default: 'Default',
    subject: 'Subject',
    body: 'Message',
    smsHint: 'Greek SMS is billed per 70 characters. Keep it short.',
    reset: 'Restore default',
    resetting: 'Restoring…',
    placeholders: 'Available variables — paste them into the text:',
  },

  workflow: {
    paid: 'Paid',
    cancelled: 'Cancelled',
    writtenOff: 'Written off',
    stepSent: (step: string) => `${step} sent`,
    stepSentFinal: (step: string) => `${step} sent (final)`,
    stepPending: (step: string) => `${step} pending`,
    daysOverdue: (n: number) => `${n} days overdue`,
    dueInDays: (n: number) => `Due in ${n} days`,
  },
};

export const DICTIONARIES: Record<Locale, typeof el> = { el, en };
export type Dictionary = typeof el;
