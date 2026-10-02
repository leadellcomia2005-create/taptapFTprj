import { ArrowLeft } from "lucide-react";
import { BrandMark } from "../../components/Branding";

export const LEGAL_DOCUMENT_VERSION = "2026-10-01";

type LegalDocumentId = "terms" | "privacy";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

const termsSections: LegalSection[] = [
  {
    title: "1. Customer accounts",
    paragraphs: [
      "Customers must provide accurate registration, contact, and delivery information and protect their password, verification codes, and account access. TapTap Foodtrip may restrict accounts involved in fraudulent orders, abuse, security violations, or repeated misuse of the website.",
    ],
  },
  {
    title: "2. Menu, prices, and availability",
    paragraphs: [
      "Menu items, prices, serving descriptions, preparation times, and availability may change. Adding an item to the cart does not reserve it. An order is accepted only after it is submitted and confirmed by the system. The items, fees, and total shown at confirmation apply to that order.",
    ],
  },
  {
    title: "3. Food quality and safety",
    paragraphs: [
      "TapTap Foodtrip aims to prepare and handle food using appropriate cleanliness, hygiene, storage, and food-safety practices. Customers should consume food within a reasonable period and store leftovers properly.",
      "Customers with allergies or dietary restrictions must review available product information and provide clear instructions before ordering. TapTap Foodtrip cannot guarantee that every product is completely free from allergens or cross-contact unless the business specifically confirms it.",
    ],
  },
  {
    title: "4. Placing an order",
    paragraphs: [
      "Before placing an order, customers must review the products, quantities, order type, contact details, delivery address or pickup information, map pin, payment method, fees, total, and special instructions.",
    ],
    bullets: [],
  },
  {
    title: "5. Payments",
    paragraphs: [
      "Available payment methods are shown during checkout and may include cash on delivery, payment on pickup, or GCash when the configured online payment provider is enabled. Online payments remain pending until the provider confirms the transaction. A screenshot alone is not final payment confirmation.",
      "TapTap Foodtrip will never ask for a password, GCash MPIN, OTP, CVV, or complete payment credentials through chat or customer support.",
    ],
  },
  {
    title: "6. Delivery, pickup, and walk-in orders",
    paragraphs: [
      "Delivery customers must provide an accurate address, Las Pinas barangay, landmark, contact number, and map pin. Preparation and delivery times are estimates and may be affected by traffic, weather, rider availability, food preparation, incorrect information, or events outside reasonable control.",
      "Customers must remain reachable while an order is active. Pickup customers are responsible for collecting their order within the agreed period. Delivery, pickup, and walk-in service remain subject to store hours and availability.",
    ],
  },
  {
    title: "7. Tracking, cancellation, and refunds",
    paragraphs: [
      "The website may show payment pending, received, preparing, ready, out for delivery, rider arrived, delivered, completed, or cancelled. Temporary status delays may occur.",
      "Customers should request cancellation as soon as possible. Cancellation may no longer be available after preparation begins or after a rider accepts the order. Incorrect, missing, damaged, or unfulfilled orders may be reviewed for refund after the customer provides the order reference and reasonable supporting information. Online refunds may follow the payment provider's processing period.",
    ],
  },
  {
    title: "8. Reviews, complaints, and support",
    paragraphs: [
      "Customers may review only their own completed orders. False, abusive, unlawful, unrelated, promotional, or privacy-violating content may be rejected or removed. Complaints are reviewed using the website's complaint and support features.",
    ],
  },
  {
    title: "9. Chatbot and staff assistance",
    paragraphs: [
      "The chatbot may answer basic menu, store, ordering, delivery, and authenticated order-status questions. It cannot place, cancel, or modify orders, approve refunds, confirm payments independently, or access another customer's information. Customers may choose Talk to staff; automated responses pause while staff handles the conversation.",
    ],
  },
  {
    title: "10. Customer responsibilities",
    bullets: [
      "Treat staff, riders, and other customers respectfully.",
      "Avoid fraudulent, abusive, or duplicate orders.",
      "Check orders upon receipt and report problems promptly.",
      "Provide safe and accessible delivery instructions.",
      "Do not interfere with website security or share passwords, OTPs, or payment credentials.",
    ],
  },
  {
    title: "11. Privacy and website availability",
    paragraphs: [
      "Account, contact, order, delivery, payment-status, review, complaint, notification, and support information is processed as described in the Privacy Notice.",
      "TapTap Foodtrip aims to keep the website available and accurate but cannot guarantee uninterrupted service during maintenance, connectivity problems, provider interruptions, or other technical incidents.",
    ],
  },
  {
    title: "12. Changes and contact",
    paragraphs: [
      "Material changes will be identified by a revised effective date. Customers may be asked to accept a new version before using affected features. Questions may be sent through TapTap Foodtrip Chat Support or the business's verified contact channel.",
    ],
  },
];

const privacySections: LegalSection[] = [
  {
    title: "1. Information we collect",
    bullets: [
      "Name, email address, phone number, and account identifiers.",
      "Delivery address, Las Pinas barangay, landmark, and delivery-map coordinates.",
      "Orders, cart details, receipts, payment status, and transaction references.",
      "Reviews, complaints, support messages, and chatbot feedback.",
      "Notification preferences, browser notification tokens, login security, audit, and fraud-prevention information.",
      "Limited website usage and technical information when analytics is enabled.",
    ],
  },
  {
    title: "2. Why we use information",
    bullets: [
      "Create, verify, and secure customer accounts.",
      "Process, prepare, deliver, and track orders.",
      "Provide receipts and important order notifications.",
      "Process payments and reconcile payment status.",
      "Handle complaints, reviews, refunds, and support requests.",
      "Maintain inventory, reports, audit records, fraud prevention, and website reliability.",
    ],
  },
  {
    title: "3. Service providers",
    paragraphs: [
      "Information may be processed by services needed to operate TapTap Foodtrip, including Firebase or Google Cloud for authentication and data storage, hosting and mapping services, notification providers, and PayMongo when online payment is enabled.",
      "When AI assistance is enabled, only limited menu, store, order-status, and sanitized recent conversation context is sent to the configured provider. Sensitive credentials and unnecessary customer details must not be included. TapTap Foodtrip does not sell customer personal information.",
    ],
  },
  {
    title: "4. Retention and security",
    paragraphs: [
      "Information is retained only for operational, security, accounting, dispute-resolution, and legal purposes. Different records may have different retention periods. TapTap Foodtrip uses authentication, role-based access, database rules, validation, audit logs, and other safeguards, although no internet-based system can guarantee absolute security.",
    ],
  },
  {
    title: "5. Your privacy rights",
    paragraphs: [
      "Subject to applicable Philippine law, customers may request access to or correction of their information, object to certain processing, request deletion or blocking when legally permitted, obtain applicable data portability, or raise a complaint. Order, payment, audit, or accounting records may need to be retained after an account-deletion request.",
    ],
  },
  {
    title: "6. Notifications and optional features",
    paragraphs: [
      "Necessary transaction and order updates may still be provided. Optional promotions, browser push, email, and SMS preferences are managed separately. Denying browser notification permission does not prevent ordinary website use.",
    ],
  },
  {
    title: "7. Contact",
    paragraphs: [
      "Privacy questions and data requests may be submitted through TapTap Foodtrip Chat Support or the business's verified contact channel. Unresolved privacy concerns may also be raised with the Philippine National Privacy Commission.",
    ],
  },
];

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
            <p>
              TapTap Foodtrip customers can contact the support team through
              Chat Support after signing in.
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}
