from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml.ns import qn
from docx.shared import Inches


SOURCE = Path(r"C:\Users\leade\Downloads\UsecaseReprint.docx")
OUTPUT = Path(r"C:\Users\leade\Documents\Codex\2026-06-10\files-mentioned-by-the-user-revi\outputs\taptap-foodtrip-integrated\output\UsecaseReprint_Pages42-56.docx")
IMAGE_DIR = Path(r"C:\Users\leade\Documents\Codex\2026-06-10\files-mentioned-by-the-user-revi\outputs\taptap-foodtrip-integrated\output\docx_activity_images")


REPLACEMENTS = {
    "Figure 3.0 Use Case Diagram for Accessing": "Figure 3.0 Use Case Diagram for TapTap Foodtrip System Access",
    "Use Case: User Authentication and Role-Based Access": "Use Case: User Authentication and Role-Based Access",
    "This use case explains how users log in to the system and what they are allowed to do once inside. Each user enters their account using a username and password, and the system checks if the information is correct before granting access. After logging in, users are given access based on their role, such as admin, staff, or customer, so they only see and use the features needed for their job. This helps keep the system organized, protects important information, and prevents unauthorized actions. It also allows the system to keep track of user activity to ensure everything is being used properly.":
        "This use case describes how registered users securely access TapTap Foodtrip. The system validates the email and password, confirms that the email and account are active, requires multi-factor authentication (MFA), and then opens the dashboard authorized for the verified role. Owner or Super Admin, Staff, Customer, and Rider accounts only receive the functions assigned to them. Invalid, unverified, suspended, or locked accounts are stopped and shown the appropriate verification, recovery, or access message.",
    "Actors: Super Admin, Admin, User, and Rider": "Actors: Owner / Super Admin, Staff, Customer, and Rider",
    "Description: Users must provide valid credentials to access the system's internal modules. The system differentiates between roles to protect sensitive business data.":
        "Description: The shared login verifies account status, email verification, MFA, and role before opening the authorized workspace.",
    "Validate Credentials: The system checks the input against the worker database.":
        "Validate Account: The system checks the email, password, account status, and email verification.",
    "Authorize Role: The system assigns the appropriate dashboard (Admin or Staff) upon successful login.":
        "Complete MFA and Authorize Role: Successful MFA opens the Customer, Staff, Rider, or Owner dashboard allowed by the verified role.",
    "Pre-Condition: The User must have registered accounts in the system database.":
        "Pre-Condition: The user must have an active account; team accounts are managed by the Owner.",
    "Post-Condition: The User is granted access (depending on the role) to the POS dashboard":
        "Post-Condition: The user receives only the dashboard and actions permitted for the verified role.",

    "Figure 3.1 Use Case Diagram Admin Side Dashboard": "Figure 3.1 Use Case Diagram for Staff Dashboard",
    "Use Case: Admin Activity": "Use Case: Staff Operations",
    "This use case describes how the admin interacts with the system to manage its overall operations. The admin is responsible for tasks such as adding, updating, or removing data, monitoring system activities, and ensuring everything runs smoothly. They have full access to important features that allow them to manage users, handle records, and make necessary changes when needed. This helps maintain the system’s organization, accuracy, and proper functioning while ensuring that all processes are controlled and up to date.":
        "This use case describes how authorized Staff members operate TapTap Foodtrip according to their assigned scope. Managers, cashiers, kitchen staff, and inventory staff use the shared workspace to process orders, record walk-in sales, prepare meals, update stock, manage shifts, respond to support requests, and review customer concerns. Owner-only functions such as managing team accounts, strategic reporting, audit review, and system recovery remain restricted.",
    "Actors: Admin": "Actors: Staff (Manager, Cashier, Kitchen, and Inventory)",
    "Description: The Admin interacts with the system to manage orders, monitor inventory, track staff activities, communicate with customers, and analyze sales data. The system supports both manual inputs and automated processes to improve efficiency and accuracy in operations.":
        "Description: Staff use role-scoped dashboards for the order queue, POS, kitchen preparation, inventory, shifts, support conversations, reviews, complaints, and workstation settings. Each completed action updates the shared operational records.",
    "Order Management: When a new order is received, it appears in the order queue. The admin accepts the order, triggering a notification to the preparation team.":
        "Order Management: Staff review authorized orders, advance preparation and handoff statuses, handle eligible cancellations, and keep customers informed through system notifications.",
    "Point-of-Sale (POS) Operations: A customer places an order at the counter. The admin inputs the order through POS, processes payment, and the system records the transaction.":
        "Point-of-Sale (POS) Operations: Authorized staff create walk-in orders during an active shift, record the selected items and payment, and issue the transaction receipt.",
    "Inventory Management: After receiving new supplies, the admin updates stock levels. If items are spoiled, they are recorded under wastage to maintain accurate inventory data.":
        "Inventory Management: Authorized staff receive stock, record wastage or adjustments, and submit controlled stock-count requests when approval is required.",
    "Shift Monitoring: At the end of a shift, the admin reviews logs to evaluate staff performance and ensure accountability.":
        "Shift Management: Staff start and close shifts, record cash movements and expenses, and submit actual cash so the system can calculate the closing variance.",
    "Communication: A customer inquires about their order status, and the admin responds through the live chat system.":
        "Customer Support: Staff may take over a customer conversation, reply through live chat, resolve complaints, moderate reviews, and return a conversation to the assistant.",
    "Product and Sales Monitoring: The admin reviews sales trends to identify peak hours and best-selling items, then generates reports for":
        "Operational Monitoring: Staff dashboards show active orders, preparation delays, ready handoffs, stock warnings, and shift information needed for daily service.",
    "strategic planning.": "",

    "Figure 3.2 Use Case Diagram User Side Dashboard": "Figure 3.2 Use Case Diagram for Customer Dashboard",
    "Use Case: User Activity": "Use Case: Customer Activity",
    "This use case describes how user interact with the system when using its services. User can access the system to view information, place orders, or use available features based on what the system offers. Their actions are limited to basic functions to ensure ease of use while keeping the system secure. This helps provide a smooth and simple experience for user while allowing them to complete their tasks efficiently.":
        "This use case describes how a Customer uses TapTap Foodtrip to browse available meals, manage a cart, complete a secure checkout, review orders and receipts, track delivery, contact support, submit feedback, and maintain profile settings. Customer actions are limited to the customer workspace and the records that belong to the signed-in account.",
    "Actor: User": "Actor: Customer",
    "Description: The user uses the system to explore available products, add items to their cart, complete purchases, and track their orders. The system provides real-time updates, communication features, and personalized account management to enhance the overall user experience.":
        "Description: The Customer searches the available menu, selects items, chooses pickup or delivery, provides the required contact and delivery information, selects COD or GCash, and monitors the resulting order through notifications, receipts, and live tracking.",
    "Menu Browsing and Cart Management: A customer browses the menu, selects items, adds them to the cart, and updates quantities or removes items before proceeding to checkout.":
        "Menu Browsing and Cart Management: The Customer searches or filters available menu items, views product details, adds eligible items to the cart, and reviews quantities before checkout.",
    "Checkout and Transaction: After reviewing the cart, the customer proceeds to checkout, completes the payment process, and receives a digital receipt as confirmation.":
        "Checkout and Transaction: The Customer selects pickup or delivery, enters contact details, confirms the delivery address and map pin when required, chooses COD or GCash, and submits the validated order.",
    "Orders and Tracking: After placing an order, the user tracks its progress and location. Once completed, they provide feedback based on their experience.":
        "Orders and Tracking: The Customer views active and previous orders, receives status updates, tracks the rider and delivery location when applicable, downloads receipts, reorders, or cancels an eligible order.",
    "Communication: If the user has inquiries or issues, they can use live chat to contact support for assistance.":
        "Support and Feedback: The Customer chats with the assistant, requests Staff support when needed, and submits a review or complaint for an eligible order.",
    "Profile Management:The user updates their delivery address and receives notifications regarding order status and promotional offers.":
        "Profile Management: The Customer updates personal information, saves delivery details, reviews account security, and manages order-notification preferences.",
    "System Behavior:Each completed order is automatically recorded and made available for tracking and review.":
        "System Behavior: Orders, payment status, inventory changes, receipts, notifications, support records, and customer feedback are stored and updated according to the completed action.",

    "Figure 3.3 Use Case Diagram for Sales Management": "Figure 3.3 Use Case Diagram for Owner / Super Admin Dashboard",
    "Use Case: Sales Management": "Use Case: Owner and Super Admin Management",
    "This use case describes how the system handles and manages sales while making sure that only authorized personnel can access these functions. It acts as a control point where important sales activities, such as viewing reports, tracking transactions, and updating sales records, are handled securely. By limiting access to specific users like admins or staff, the system helps protect sensitive sales information and ensures that all sales data is accurate, organized, and properly managed within the Taptap Foodtrip system.":
        "This use case describes how the Owner or Super Admin monitors business performance and controls owner-only functions. The owner reviews sales and orders, inventory, reports, COD reconciliation, customer concerns, user access, audit logs, approvals, and system settings. Forecasts and recommendations remain advisory and require owner review.",
    "Primary Actor: Super Admin": "Primary Actor: Owner / Super Admin",
    "Description: The user initiates a session by providing credentials. The system acts as a filter to protect sensitive inventory and sales data.":
        "Description: After verified login and MFA, the Owner reviews KPIs, manages menu and inventory settings, generates reports, reconciles COD cash, manages team accounts, and administers system controls.",
    "Verify Password: The system performs a mandatory check against the database to validate the provided credentials.":
        "Monitor Business Performance: The system calculates sales, payment, delivery, complaint, inventory, and shift indicators from authorized operational records.",
    "Extended Use Cases:": "Extended Use Cases:",
    "Login Error: A conditional flow that is triggered if the \"Verify Password\" process fails, resulting in an error notification to the user.":
        "Decision Support: The Owner may generate KPI analysis, review forecasts, print a daily report, confirm or dispute COD remittance, and act on ranked recommendations.",
    "Pre-condition: The user must have a pre-registered account in the system database.":
        "Pre-condition: The Owner must have an active, email-verified owner account and successfully complete MFA.",
    "Post-condition: Upon successful verification, the user is redirected to the management dashboard.":
        "Post-condition: Authorized owner actions update the relevant management records and are preserved in the audit trail.",
    "Figure 3.4 Use Case Diagram for Rider Delivery Management": "Figure 3.4 Use Case Diagram for Rider Delivery Management",
}


def replace_text_preserving_runs(paragraph, new_text: str) -> None:
    if paragraph.runs:
        paragraph.runs[0].text = new_text
        for run in paragraph.runs[1:]:
            run.text = ""
    else:
        paragraph.add_run(new_text)


def copy_paragraph_format(target, source) -> None:
    if source._p.pPr is not None:
        preserved_section = None
        if target._p.pPr is not None:
            section_properties = target._p.pPr.find(qn("w:sectPr"))
            if section_properties is not None:
                preserved_section = deepcopy(section_properties)
            target._p.remove(target._p.pPr)
        copied = deepcopy(source._p.pPr)
        source_section = copied.find(qn("w:sectPr"))
        if source_section is not None:
            copied.remove(source_section)
        if preserved_section is not None:
            copied.append(preserved_section)
        target._p.insert(0, copied)


def add_formatted_paragraph(document, text, template, include_numbering=True):
    paragraph = document.add_paragraph()
    copy_paragraph_format(paragraph, template)
    if not include_numbering and paragraph._p.pPr is not None:
        num_pr = paragraph._p.pPr.numPr
        if num_pr is not None:
            paragraph._p.pPr.remove(num_pr)
    run = paragraph.add_run(text)
    if template.runs and template.runs[0]._r.rPr is not None:
        run._r.insert(0, deepcopy(template.runs[0]._r.rPr))
    return paragraph


def main() -> None:
    doc = Document(SOURCE)
    paragraphs = list(doc.paragraphs)
    by_text = {p.text.strip(): p for p in paragraphs if p.text.strip()}

    missing = [text for text in REPLACEMENTS if text not in by_text]
    if missing:
        raise RuntimeError(f"Missing expected source paragraphs: {missing}")

    for original, replacement in REPLACEMENTS.items():
        replace_text_preserving_runs(by_text[original], replacement)

    use_case_template = by_text["Use Case: Sales Management"]
    body_template = by_text[
        "This use case describes how the system handles and manages sales while making sure that only authorized personnel can access these functions. It acts as a control point where important sales activities, such as viewing reports, tracking transactions, and updating sales records, are handled securely. By limiting access to specific users like admins or staff, the system helps protect sensitive sales information and ensures that all sales data is accurate, organized, and properly managed within the Taptap Foodtrip system."
    ]
    bullet_template = by_text["Primary Actor: Super Admin"]
    included_template = by_text["Included Use Cases:"]
    nested_template = by_text["Verify Password: The system performs a mandatory check against the database to validate the provided credentials."]
    precondition_template = by_text["Pre-condition: The user must have a pre-registered account in the system database."]

    # Fill the existing blank Section 8, which is physical page 49.
    final_blank = doc.paragraphs[-1]
    copy_paragraph_format(final_blank, use_case_template)
    num_pr = final_blank._p.pPr.numPr if final_blank._p.pPr is not None else None
    if num_pr is not None:
        final_blank._p.pPr.remove(num_pr)
    heading_run = final_blank.add_run("1.5 Use Case: Rider Delivery Management")
    if use_case_template.runs and use_case_template.runs[0]._r.rPr is not None:
        heading_run._r.insert(0, deepcopy(use_case_template.runs[0]._r.rPr))

    add_formatted_paragraph(
        doc,
        "After verified login and MFA, the Rider accepts ready deliveries, shares live GPS, navigates to the customer, updates pickup and arrival status, records proof, reports issues, and manages COD handoff. Each action updates customer tracking and the shared order record.",
        body_template,
    )
    add_formatted_paragraph(doc, "Actor: Rider", bullet_template)
    add_formatted_paragraph(
        doc,
        "Description: The Rider workspace supports GPS, delivery jobs, navigation, customer contact, status updates, proof, issue reporting, and COD records.",
        bullet_template,
    )
    add_formatted_paragraph(doc, "Included Use Cases:", included_template)
    rider_items = [
        "Availability and Tracking: The Rider goes online and allows location access for live GPS updates.",
        "Delivery Jobs and Navigation: The Rider accepts an eligible ready order and uses the map or external navigation.",
        "Status and Exceptions: The Rider confirms pickup and arrival, contacts the customer, and reports delivery issues.",
        "Proof of Delivery: The Rider captures the handoff photo and receiver details before completion.",
        "COD Handoff: The Rider reviews collected COD cash and records its physical handoff for owner confirmation.",
    ]
    for item in rider_items:
        add_formatted_paragraph(doc, item, nested_template)
    add_formatted_paragraph(
        doc,
        "Pre-condition: The Rider must have a verified rider account, complete MFA, and allow location and camera permissions.",
        precondition_template,
    )
    add_formatted_paragraph(
        doc,
        "Post-condition: Delivery status, location, proof, issues, and COD handoff are saved for authorized workflows.",
        precondition_template,
    )

    # Pages 50-56: exactly one activity-diagram picture per page, no added descriptions.
    image_names = [
        "activity-4-0-customer-registration.png",
        "activity-4-1-staff-login.png",
        "activity-4-2-customer-browse-menu.png",
        "activity-4-3-customer-order.png",
        "activity-4-4-owner-login.png",
        "activity-4-5-owner-manage-products.png",
        "activity-4-6-owner-sales-report.png",
    ]
    for image_name in image_names:
        paragraph = doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = 0
        paragraph.paragraph_format.space_after = 0
        paragraph.paragraph_format.line_spacing = 1
        run = paragraph.add_run()
        run.add_break(WD_BREAK.PAGE)
        run.add_picture(str(IMAGE_DIR / image_name), width=Inches(6.15))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
