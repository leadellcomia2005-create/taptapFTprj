import { ArrowLeft } from "lucide-react";
import { BrandMark } from "../../components/Branding";
import { LEGAL_BUSINESS_ADDRESS, LEGAL_BUSINESS_NAME, privacySections, termsSections } from "./legalContent";

export const LEGAL_DOCUMENT_VERSION = "2026-10-01";

type LegalDocumentId = "terms" | "privacy";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};


const documents = {
  terms: {
    eyebrow: "Customer agreement",
    title: "Terms and Conditions",
    summary:
      "Rules for customer accounts, ordering, payment, delivery, support, and responsible use of TapTap Foodtrip.",
    sections: termsSections,
  },
  privacy: {
    eyebrow: "Privacy information",
    title: "Privacy Notice",
    summary:
      "How TapTap Foodtrip collects, uses, protects, and retains customer information.",
    sections: privacySections,
  },
} satisfies Record<
  LegalDocumentId,
  { eyebrow: string; title: string; summary: string; sections: LegalSection[] }
>;

export function LegalPage({ documentId }: { documentId: LegalDocumentId }) {
  const document = documents[documentId];
  const alternateId: LegalDocumentId =
    documentId === "terms" ? "privacy" : "terms";
  return (
    <div className="legal-page-shell">
      <header className="legal-page-header">
        <a
          className="legal-brand"
          href="/#home"
          aria-label="Return to TapTap Foodtrip home"
        >
          <BrandMark />
          <span>
            <strong>TapTap</strong>
            <small>FOODTRIP</small>
          </span>
        </a>
        <a className="legal-back-link" href="/#home">
          <ArrowLeft size={17} aria-hidden="true" />
          Back to website
        </a>
      </header>
      <main className="legal-page-main">
        <aside className="legal-page-aside" aria-label="Legal documents">
          <span>Legal documents</span>
          <a className={documentId === "terms" ? "active" : ""} href="/#terms">
            Terms and Conditions
          </a>
          <a
            className={documentId === "privacy" ? "active" : ""}
            href="/#privacy"
          >
            Privacy Notice
          </a>
        </aside>
        <article className="legal-document">
          <header>
            <p className="eyebrow text-danger">{document.eyebrow}</p>
            <h1>{document.title}</h1>
            <p>{document.summary}</p>
            <p><strong>Business name:</strong> {LEGAL_BUSINESS_NAME}<br /><strong>Business address:</strong> {LEGAL_BUSINESS_ADDRESS}</p>
            <div>
              <span>Effective October 1, 2026</span>
              <span>Version {LEGAL_DOCUMENT_VERSION}</span>
            </div>
          </header>
          <div className="legal-document-sections">
            {document.sections.map((section) => (
              <section key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets?.length ? (
                  <ul>
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
          <footer>
            <p>
              Also review the{" "}
              <a href={`/#${alternateId}`}>{documents[alternateId].title}</a>.
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}
