type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[] };

export const LEGAL_BUSINESS_NAME = "TapTap Foodtrip";
export const LEGAL_BUSINESS_ADDRESS = "#17 Gemini Street, Pamplona Park, Pamplona Dos, Las Piñas City 1740";

export const termsSections: LegalSection[] = [
  { title: "1. About these terms", paragraphs: [
    "These Terms and Conditions govern use of the TapTap Foodtrip website and its ordering, payment, delivery, pickup, review, and support services.",
    "Read these terms before creating an account or placing an order. Nothing in these terms limits rights or remedies provided by applicable Philippine law."
  ] },
  { title: "2. Accounts and responsible use", paragraphs: [
    "Provide accurate account, contact, and delivery information. Keep your password and verification codes confidential, and report suspected unauthorized access through Chat Support.",
    "Customers may access only their own information. Owner, staff, and rider accounts are restricted to their authorized responsibilities.",
    "Fraudulent orders, harassment, unauthorized access, interference with the website, and misuse of another person's information are prohibited. Access may be restricted when reasonably necessary to investigate misuse or protect customers and the business."
  ] },
  { title: "3. Menu, prices, and availability", paragraphs: [
    "Products, prices, and availability are displayed through the website. Adding an item to a cart does not reserve stock.",
    "Before submitting an order, review its items, quantities, payment method, fulfillment option, delivery details, fees, and total. Any proposed change to an accepted order's items or charges must be communicated to the customer.",
    "Product photographs are illustrative; presentation may vary."
  ] },
  { title: "4. Payments and receipts", paragraphs: [
    "Use only payment methods available during checkout. Online payment options are available only when enabled and operational.",
    "Cash payments must be settled according to the selected fulfillment method. Online payment status depends on confirmation from the payment service; a screenshot alone is not confirmation.",
    "Digital receipts and transaction records are available through the applicable account features. Never share your banking password, payment PIN, or payment verification codes with staff, riders, or chat support."
  ] },
  { title: "5. Delivery, pickup, and tracking", paragraphs: [
    "Delivery availability depends on the service area, store hours, and operational capacity. Provide a complete address, reachable telephone number, relevant landmark, and accurate delivery pin where required.",
    "Preparation times, arrival estimates, maps, and status updates are estimates. Traffic, weather, connectivity, location accuracy, and rider availability may affect them.",
    "Customers should remain reachable during delivery. Pickup customers should collect their orders within the arrangements confirmed by the store.",
    "A rider may record delivery evidence, including a delivery photograph, receiver name, typed signature, or delivery verification result, as explained in the Privacy Notice."
  ] },
  { title: "6. Food information and concerns", paragraphs: [
    "Review available food and allergen information. Ask the store through Chat Support before ordering if you have an allergy or dietary requirement. Special instructions are subject to the store's ability to accommodate them; an allergen-free environment should not be assumed.",
    "Inspect your order upon receipt and report missing, incorrect, damaged, or potentially unsafe items promptly. A photograph or order reference may help an investigation, but statutory remedies are not conditional on providing evidence that the law does not require."
  ] },
  { title: "7. Cancellations, complaints, and refunds", paragraphs: [
    "Cancellation availability depends on the order's current stage and the options shown in the system. Use Chat Support promptly if cancellation is no longer available on screen.",
    "Complaints are assessed according to the circumstances and applicable consumer rights. Appropriate remedies may include replacement, refund, or another lawful resolution. A change of mind does not automatically establish entitlement to a refund.",
    "The website does not automatically process refunds. Where a refund is due, the business must communicate the arrangements and expected processing time. The absence of an automated refund feature does not remove a customer's legal rights."
  ] },
  { title: "8. Reviews and support", paragraphs: [
    "Reviews must relate to your own eligible order and reflect your experience. Reviews may be moderated for abuse, spam, unlawful content, or disclosure of personal information. Negative feedback alone is not a reason for removal.",
    "Automated chat assistance may provide general information but can make mistakes. Use staff support for unresolved problems, payment disputes, or matters requiring an authorized decision."
  ] },
  { title: "9. Availability and responsibility", paragraphs: [
    "Technical interruptions may temporarily affect ordering, tracking, or access to records. Use Chat Support if an order's payment or fulfillment status is unclear before repeating a transaction.",
    "Each party remains responsible for its acts and obligations under applicable law. These terms do not exclude liability or remedies that cannot lawfully be excluded."
  ] },
  { title: "10. Changes and applicable law", paragraphs: [
    "Material changes will be identified by a revised effective date and communicated appropriately. Changes will not retrospectively remove rights relating to an existing transaction.",
    "These terms are governed by Philippine law, without restricting access to competent consumer authorities or other lawful remedies. Questions and complaints may be submitted through the website's Chat Support."
  ] }
];

export const privacySections: LegalSection[] = [
  { title: "1. Scope", paragraphs: [
    "This Privacy Policy and Notice explains how TapTap Foodtrip processes personal information through its website and related business operations. TapTap Foodtrip is responsible for the personal information it controls.",
    "It covers customers, receivers, staff, and riders whose information is handled by the system. Processing is subject to the Philippine Data Privacy Act of 2012 and other applicable requirements."
  ] },
  { title: "2. Information processed", bullets: [
    "Name, email address, telephone number, account identifiers, and security-verification information.",
    "Delivery address, barangay, landmark, delivery pin, and relevant location coordinates.",
    "Order contents, amounts, payment method, payment status, transaction references, and receipts.",
    "Delivery assignments, status timestamps, and rider location updates during enabled tracking.",
    "Proof-of-delivery photographs, receiver names, typed signatures, and delivery verification results.",
    "Reviews, complaints, support conversations, and feedback.",
    "Staff shift records, cash-handoff records, inventory actions, and audit logs.",
    "Notification preferences, push-notification tokens, and technical or usage information when the relevant features are enabled."
  ], paragraphs: ["Avoid including unnecessary personal information in reviews, chat messages, order notes, and photographs."] },
  { title: "3. Purposes and lawful grounds", paragraphs: [
    "Information is used to manage accounts, fulfill orders, coordinate deliveries, verify handoffs, issue receipts, provide support, investigate complaints, reconcile transactions, secure the system, and meet applicable obligations.",
    "Depending on the activity, processing may be necessary to perform a transaction, comply with a legal obligation, pursue a legitimate interest subject to appropriate safeguards, or act on valid consent. Consent for an optional feature does not authorize unrelated uses of your information."
  ] },
  { title: "4. Location, camera, and notifications", paragraphs: [
    "Delivery pins help identify the drop-off point. Rider location updates support delivery coordination when tracking is enabled.",
    "Camera access supports proof-of-delivery capture. Proof photographs should focus on the handoff or delivered items and avoid unnecessary images of faces, identity documents, or private premises.",
    "Browser permissions and optional notification preferences can be managed through the website or device settings. Disabling them may limit the related feature but does not itself delete existing records."
  ] },
  { title: "5. Access and disclosure", paragraphs: [
    "Authorized personnel receive access according to their role. Staff may access information needed for fulfillment and support; riders receive information needed for their assigned deliveries; owners access records needed to operate and supervise the business.",
    "Service providers may process information for authentication, hosting, storage, mapping, communication, payment, security, analytics, or enabled AI assistance. Providers may include Google/Firebase, mapping services, and configured payment or messaging providers.",
    "Relevant information may be processed outside the Philippines, subject to applicable safeguards. Information may also be disclosed where required by law or necessary for a lawful investigation or dispute. Personal information is not offered for sale."
  ] },
  { title: "6. Automated assistance and public reviews", paragraphs: [
    "When automated assistance is enabled, relevant conversation content and limited service or order context may be processed by the configured provider. Do not provide passwords, payment PINs, or unnecessary sensitive information in chat.",
    "Approved reviews may appear publicly with a limited customer label and review details. Private contact information, delivery addresses, and payment credentials should not be published with a review."
  ] },
  { title: "7. Storage, retention, and security", paragraphs: [
    "Authentication, role restrictions, database rules, validation, and other safeguards are used to protect records. No online service can guarantee absolute security.",
    "Records are retained only as necessary for the stated purposes, legal obligations, security, accounting, and dispute handling. Different record types may require different retention periods.",
    "Records should be securely deleted or anonymized when retention is no longer justified. A deletion request may not require immediate removal of records that must lawfully be retained."
  ] },
  { title: "8. Browser storage and optional analytics", paragraphs: [
    "The website uses browser storage for functions such as account sessions, cart recovery, checkout drafts, preferences, and cached application files.",
    "When optional analytics is enabled, it is used to understand website use and improve reliability. Any required notice and choices apply to that processing. Clearing browser storage may remove local preferences or drafts without deleting server records."
  ] },
  { title: "9. Academic demonstration and research", paragraphs: [
    "Thesis presentations and documentation should use test records or anonymized material wherever possible.",
    "Any proposed research use of identifiable customer, staff, or rider information requires an appropriate lawful basis, suitable notice, access controls, and any consent or approval required for that activity. Identifiable records should not be exposed in public screenshots or presentations without appropriate authorization."
  ] },
  { title: "10. Your rights and requests", paragraphs: [
    "Subject to applicable law, you may exercise rights to information, access, correction, objection, erasure or blocking, applicable data portability, and redress.",
    "Use the website's Chat Support to submit a privacy request or raise a concern. Reasonable identity verification may be needed to protect your records. Any lawful restriction or retention requirement affecting a request will be explained.",
    "You may also raise privacy concerns with the Philippine National Privacy Commission."
  ] },
  { title: "11. Updates", paragraphs: [
    "Material changes to this notice will be communicated appropriately and identified by a revised effective date. Where required, further notice or consent will be obtained before information is used for a new purpose."
  ] }
];
