import type { Locale } from '@/lib/i18n/dictionaries';

/**
 * The guide articles.
 *
 * Content, not marketing. A landing page ranks for its own name and very little
 * else; what earns a result for "είσπραξη ανεξόφλητων τιμολογίων" is a page that
 * answers the question someone actually typed. Each of these is written from
 * what building the product taught us — the myDATA gap, what a reminder cadence
 * looks like in practice — rather than assembled from keywords.
 *
 * Held as data rather than MDX: three articles do not justify a content
 * pipeline, and this keeps them typed, translatable and impossible to break with
 * stray markup.
 *
 * The slug is shared by both languages and the Greek spelling is kept, because
 * both languages answer on the same URL — chosen by the account and a cookie —
 * and they share one canonical rather than splitting rank. A separate English
 * slug would be a second URL for the same article, competing with it.
 *
 * `Record<Locale, …>` on the copy rather than an array per language: an article
 * added in one language and forgotten in the other is then a compile error
 * rather than a page that silently serves Greek to an English reader, which is
 * what this whole section did until now.
 */

export interface GuideSection {
  heading: string;
  paragraphs: string[];
}

export interface GuideCopy {
  title: string;
  /** Also the meta description; kept to one sentence for that reason. */
  summary: string;
  sections: GuideSection[];
}

export interface Guide {
  slug: string;
  published: string;
  copy: Record<Locale, GuideCopy>;
}

export const GUIDES: Guide[] = [
  {
    slug: 'eispraxi-anexoflitwn-timologiwn',
    published: '2026-08-19',
    copy: {
      el: {
        title: 'Πώς να εισπράξετε ανεξόφλητα τιμολόγια χωρίς να χαλάσετε τη σχέση',
        summary:
          'Τι δουλεύει στην πράξη όταν ένας πελάτης δεν πληρώνει: πότε να στείλετε υπενθύμιση, τι να γράψετε και πότε σταματά η αυτοματοποίηση.',
        sections: [
          {
            heading: 'Το πρόβλημα δεν είναι η είσπραξη, είναι ο χρόνος',
            paragraphs: [
              'Οι περισσότερες μικρές επιχειρήσεις δεν χάνουν χρήματα επειδή οι πελάτες αρνούνται να πληρώσουν. Τα χάνουν επειδή κανείς δεν προλαβαίνει να θυμηθεί ποιος χρωστάει τι, και το τιμολόγιο μένει ανοιχτό μέχρι να γίνει αμήχανο να το αναφέρεις.',
              'Ένα ανεξόφλητο τιμολόγιο δύο εβδομάδων εισπράττεται με ένα μήνυμα. Το ίδιο τιμολόγιο έξι μηνών θέλει τηλέφωνο, διαπραγμάτευση, και συχνά έκπτωση. Η διαφορά δεν είναι ο πελάτης — είναι πόσο γρήγορα τον θυμήσατε.',
            ],
          },
          {
            heading: 'Τρία βήματα φτάνουν',
            paragraphs: [
              'Μια υπενθύμιση λίγες μέρες πριν τη λήξη δεν είναι όχληση· είναι εξυπηρέτηση, και εισπράττει περισσότερα από οποιοδήποτε μήνυμα μετά. Δεύτερη λίγες μέρες μετά τη λήξη, όταν είναι πιθανότερο να πρόκειται για αβλεψία παρά για άρνηση. Τρίτη γύρω στις δέκα ημέρες, με σαφή διατύπωση ότι είναι η τελευταία αυτόματη.',
              'Περισσότερα από τρία μηνύματα δεν αυξάνουν την είσπραξη — μειώνουν την προσοχή. Όποιος αγνόησε τρία, αγνοεί και το δέκατο· εκείνο το σημείο θέλει άνθρωπο στο τηλέφωνο, όχι άλλο email.',
            ],
          },
          {
            heading: 'Τι να γράψετε',
            paragraphs: [
              'Αριθμός παραστατικού, ποσό, ημερομηνία λήξης, τρόπος πληρωμής. Χωρίς συναίσθημα και χωρίς απειλές. Ο παραλήπτης πρέπει να μπορεί να πληρώσει χωρίς να απαντήσει σε τίποτα και χωρίς να ψάξει στοιχεία λογαριασμού.',
              'Ο σύνδεσμος άμεσης πληρωμής αλλάζει το ποσοστό απόκρισης περισσότερο από τη διατύπωση. Κάθε βήμα που προσθέτετε — «στείλτε μας email», «καλέστε μας» — είναι ένα σημείο όπου η είσπραξη σταματά.',
            ],
          },
          {
            heading: 'Πού σταματά η αυτοματοποίηση',
            paragraphs: [
              'Ένα λογισμικό υπενθυμίσεων δεν είναι εισπρακτική εταιρεία και δεν πρέπει να συμπεριφέρεται σαν τέτοια. Διαβιβάζει υπενθυμίσεις για λογαριασμό σας: δεν αναλαμβάνει την απαίτηση, δεν διαπραγματεύεται και δεν ασκεί πίεση.',
              'Πρακτικά αυτό σημαίνει σταθερή ροή, ανώτατο όριο επαφών ανά πελάτη ανά ημέρα, δυνατότητα να θέσετε κάποιον σε παύση αμέσως, και πλήρες αρχείο του τι στάλθηκε και πότε. Αν διαφωνήσει ποτέ κάποιος για το τι έλαβε, το αρχείο είναι η απάντηση.',
            ],
          },
        ],
      },
      en: {
        title: 'How to collect unpaid invoices without damaging the relationship',
        summary:
          'What actually works when a customer has not paid: when to send a reminder, what to write, and where automation should stop.',
        sections: [
          {
            heading: 'The problem is not collection, it is time',
            paragraphs: [
              'Most small businesses do not lose money because customers refuse to pay. They lose it because nobody has time to keep track of who owes what, and the invoice stays open until bringing it up feels awkward.',
              'An invoice two weeks overdue is collected with one message. The same invoice six months later takes a phone call, a negotiation and often a discount. The difference is not the customer — it is how quickly you reminded them.',
            ],
          },
          {
            heading: 'Three steps are enough',
            paragraphs: [
              'A reminder a few days before the due date is not chasing, it is service, and it collects more than any message sent afterwards. A second a few days after the date, while an oversight is still more likely than a refusal. A third at around ten days, saying plainly that it is the last automatic one.',
              'More than three messages does not raise collection, it lowers attention. Somebody who ignored three will ignore the tenth; that point needs a person on the phone, not another email.',
            ],
          },
          {
            heading: 'What to write',
            paragraphs: [
              'Invoice number, amount, due date, how to pay. No emotion and no threats. The reader should be able to pay without replying to anything and without hunting for bank details.',
              'A direct payment link changes the response rate more than the wording does. Every step you add — "email us", "call us" — is a place where collection stops.',
            ],
          },
          {
            heading: 'Where automation should stop',
            paragraphs: [
              'Reminder software is not a debt collection agency and should not behave like one. It passes reminders on for you: it does not take over the claim, negotiate it, or apply pressure.',
              'In practice that means a fixed sequence, a ceiling of one contact per customer per day, the ability to pause somebody immediately, and a complete record of what was sent and when. If anyone ever disputes what they received, the record is the answer.',
            ],
          },
        ],
      },
    },
  },
  {
    slug: 'mydata-anexoflita-timologia',
    published: '2026-08-19',
    copy: {
      el: {
        title: 'myDATA και ανεξόφλητα τιμολόγια: τι δείχνει και τι όχι',
        summary:
          'Το myDATA γνωρίζει τι εκδώσατε, όχι ποιος σας χρωστάει. Τι λείπει από τα δεδομένα και πώς καλύπτεται.',
        sections: [
          {
            heading: 'Τι περιέχει πραγματικά',
            paragraphs: [
              'Το myDATA είναι φορολογικό αρχείο, όχι σύστημα απαιτήσεων. Κάθε παραστατικό που εκδίδετε διαβιβάζεται και παίρνει MARK, τον μοναδικό αριθμό της ΑΑΔΕ. Αυτό αρκεί για τη φορολογική συμμόρφωση και δεν αρκεί για να κυνηγήσετε μια οφειλή.',
              'Δύο πράγματα λείπουν και τα δύο είναι καθοριστικά: το myDATA δεν καταγράφει αν ένα παραστατικό πληρώθηκε, και στη λιανική δεν φέρει τον αντισυμβαλλόμενο. Ένα παραστατικό λιανικής χωρίς ΑΦΜ πελάτη δεν σας λέει σε ποιον να στείλετε υπενθύμιση.',
            ],
          },
          {
            heading: 'Γιατί αυτό έχει σημασία στην πράξη',
            paragraphs: [
              'Σε λογαριασμό λιανικής η συντριπτική πλειοψηφία των παραστατικών ενός μήνα δεν φέρει στοιχεία πελάτη. Αν στηριχτείτε μόνο στο myDATA, βλέπετε ποσά χωρίς ονόματα — σωστά για το βιβλίο, άχρηστα για την είσπραξη.',
              'Για επιχείρηση που τιμολογεί σε άλλες επιχειρήσεις η εικόνα είναι καλύτερη, γιατί το ΑΦΜ του αντισυμβαλλομένου υπάρχει. Ακόμη κι εκεί όμως λείπει το email και το τηλέφωνο: δεν είναι στοιχεία του παραστατικού και δεν διαβιβάζονται ποτέ.',
            ],
          },
          {
            heading: 'Τι καλύπτει το κενό',
            paragraphs: [
              'Το πρόγραμμα τιμολόγησής σας. Εκεί υπάρχει το όνομα, το email και συνήθως το τηλέφωνο, μαζί με την πραγματική ημερομηνία λήξης κάθε παραστατικού — που το myDATA επίσης δεν φέρει.',
              'Ο συνδυασμός δουλεύει: το myDATA επιβεβαιώνει τι εκδόθηκε επίσημα, το σύστημα τιμολόγησης λέει σε ποιον και μέχρι πότε. Το MARK λειτουργεί ως κοινό κλειδί ώστε το ίδιο παραστατικό να μην μετρηθεί δύο φορές.',
            ],
          },
        ],
      },
      en: {
        title: 'myDATA and unpaid invoices: what it shows and what it does not',
        summary:
          'myDATA knows what you issued, not who owes you. What is missing from the data, and what fills the gap.',
        sections: [
          {
            heading: 'What it actually contains',
            paragraphs: [
              'myDATA is a tax record, not a receivables system. Every document you issue is transmitted and gets a MARK, the unique number assigned by the Greek tax authority. That is enough for tax compliance and not enough to chase a debt.',
              'Two things are missing and both are decisive: myDATA does not record whether a document was paid, and on retail documents it does not carry the counterparty. A retail document with no customer VAT number does not tell you who to remind.',
            ],
          },
          {
            heading: 'Why that matters in practice',
            paragraphs: [
              'On a retail account the overwhelming majority of a month’s documents carry no customer details at all. Rely on myDATA alone and you see amounts without names — correct for the books, useless for collection.',
              'For a business invoicing other businesses the picture is better, because the counterparty VAT number is there. Even then the email address and the phone number are not: they are not part of a tax document and are never transmitted.',
            ],
          },
          {
            heading: 'What fills the gap',
            paragraphs: [
              'Your invoicing software. That is where the name, the email address and usually the phone number live, together with the real due date of each document — which myDATA does not carry either.',
              'The combination works: myDATA confirms what was officially issued, the invoicing system says to whom and by when. The MARK acts as the shared key, so the same document is never counted twice.',
            ],
          },
        ],
      },
    },
  },
  {
    slug: 'ypenthymisi-pliromis-ti-na-grapsete',
    published: '2026-08-19',
    copy: {
      el: {
        title: 'Υπενθύμιση πληρωμής: τι να γράψετε σε email και SMS',
        summary:
          'Πρακτικά παραδείγματα διατύπωσης για κάθε στάδιο, και γιατί το SMS έχει άλλους κανόνες από το email.',
        sections: [
          {
            heading: 'Πριν τη λήξη',
            paragraphs: [
              'Ο σκοπός εδώ δεν είναι η όχληση αλλά η υπενθύμιση σε κάποιον που θέλει να πληρώσει και το ξέχασε. Αναφέρετε το παραστατικό, το ποσό και την ημερομηνία, και δώστε τον σύνδεσμο πληρωμής.',
              'Αυτό το μήνυμα εισπράττει δυσανάλογα πολλά σε σχέση με το πόσο λίγο κοστίζει να σταλεί, ακριβώς επειδή φτάνει πριν δημιουργηθεί οποιαδήποτε αμηχανία.',
            ],
          },
          {
            heading: 'Μετά τη λήξη',
            paragraphs: [
              'Αλλάζει ένα πράγμα: αναφέρετε ρητά ότι το παραστατικό εμφανίζεται ως ανεξόφλητο. Δεν κατηγορείτε — αφήνετε περιθώριο ότι μπορεί να έχει πληρωθεί και να μην έχει καταχωρηθεί ακόμη, και προσκαλείτε να επικοινωνήσουν αν υπάρχει θέμα με το ίδιο το παραστατικό.',
              'Στην τελική υπενθύμιση πείτε καθαρά ότι είναι η τελευταία αυτόματη. Είναι ειλικρινές, και είναι το σημείο όπου ο παραλήπτης καταλαβαίνει ότι μετά ακολουθεί άνθρωπος.',
            ],
          },
          {
            heading: 'Το SMS δεν είναι σύντομο email',
            paragraphs: [
              'Τα ελληνικά γράφονται σε UCS-2, οπότε ένα SMS χωράει 70 χαρακτήρες αντί για 160. Με τον σύνδεσμο πληρωμής μέσα, ένα φυσιολογικό μήνυμα πιάνει δύο ή τρία τμήματα — και χρεώνεστε ανά τμήμα.',
              'Γι᾽ αυτό το SMS λέει ένα πράγμα: ποιος, πόσο, πού να πληρώσει. Οι εξηγήσεις πάνε στο email. Ένας σύντομος σύνδεσμος αντί για μακρύ κερδίζει συχνά ένα ολόκληρο τμήμα.',
            ],
          },
        ],
      },
      en: {
        title: 'Payment reminders: what to write in an email and in an SMS',
        summary:
          'Practical wording for each stage, and why an SMS follows different rules from an email.',
        sections: [
          {
            heading: 'Before the due date',
            paragraphs: [
              'The point here is not to chase but to remind somebody who intends to pay and forgot. Name the document, the amount and the date, and give them the payment link.',
              'This message collects far more than it costs to send, precisely because it arrives before any awkwardness exists.',
            ],
          },
          {
            heading: 'After the due date',
            paragraphs: [
              'One thing changes: say explicitly that the invoice shows as unpaid. You are not accusing anyone — leave room for it having been paid and not yet recorded, and invite them to get in touch if there is a problem with the document itself.',
              'On the final reminder, say clearly that it is the last automatic one. It is honest, and it is the point at which the reader understands that a person follows.',
            ],
          },
          {
            heading: 'An SMS is not a short email',
            paragraphs: [
              'Greek is encoded as UCS-2, so an SMS holds 70 characters instead of 160. With a payment link inside, an ordinary message runs to two or three segments — and you are billed per segment.',
              'So the SMS says one thing: who, how much, where to pay. The explanations belong in the email. A short link rather than a long one often saves a whole segment.',
            ],
          },
        ],
      },
    },
  },
];

export function findGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

/** One article in one language. */
export function guideCopy(guide: Guide, locale: Locale): GuideCopy {
  return guide.copy[locale];
}
