import { CONTRACT_VERSION } from "@/lib/contracts";

/** Η μηχανή δεν έχει χρήστες: η σελίδα λέει μόνο τι είναι και πού γίνεται η διαχείριση. */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-4 py-12">
      <h1 className="font-semibold" style={{ fontSize: "var(--fs-22)" }}>Euronics — μηχανή διαθεσιμότητας</h1>
      <p>Εσωτερική υπηρεσία που συγχρονίζει το στοκ των καταστημάτων-μελών. Η διαχείριση, οι συνδέσεις και ο έλεγχός τους γίνονται από τη διαχείριση του euronics.gr και την πύλη B2B.</p>
      <p className="opacity-70" style={{ fontSize: "var(--fs-13)" }}>Για τεχνικούς ERP: η αποστολή στοκ γίνεται στο <code>POST /api/v1/stock</code> με το κλειδί που σας δόθηκε. Συμβόλαιο {CONTRACT_VERSION}.</p>
    </main>
  );
}
