from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "role-reference-assets"
OUTPUT = ROOT / "docs" / "BuildTrack Main Roles and Access Reference.docx"

GREEN = "063B2C"
GREEN_2 = "0F6B4E"
GOLD = "F2B51D"
PALE = "EDF4F1"
PALE_ALT = "F7F8F6"
GRAY = "66736E"
LINE = "D9DEDB"
BLACK = RGBColor(0, 0, 0)


def set_cell_fill(cell, color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), color)


def set_cell_margins(cell, top=100, start=120, bottom=100, end=120):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=LINE, size="5"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge_name in ("top", "left", "bottom", "right", "insideH", "insideV"):
        edge = borders.find(qn(f"w:{edge_name}"))
        if edge is None:
            edge = OxmlElement(f"w:{edge_name}")
            borders.append(edge)
        edge.set(qn("w:val"), "single")
        edge.set(qn("w:sz"), size)
        edge.set(qn("w:space"), "0")
        edge.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    tr_pr.append(repeat)


def set_keep_with_next(paragraph, value=True):
    paragraph.paragraph_format.keep_with_next = value


def set_keep_together(paragraph, value=True):
    paragraph.paragraph_format.keep_together = value


def set_image_alt(inline_shape, text):
    doc_pr = inline_shape._inline.docPr
    doc_pr.set("descr", text)
    doc_pr.set("title", text)


def add_page_field(paragraph):
    run = paragraph.add_run()
    fld_char = OxmlElement("w:fldChar")
    fld_char.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char, instr, fld_sep, fld_end])


def configure_document(doc):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.68)
    section.bottom_margin = Inches(0.62)
    section.left_margin = Inches(0.72)
    section.right_margin = Inches(0.72)

    styles = doc.styles
    for name in ("Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3", "Caption"):
        style = styles[name]
        style.font.name = "Aptos"
        style.font.color.rgb = BLACK
        style._element.rPr.rFonts.set(qn("w:ascii"), "Aptos")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos")
        for border in list(style.element.xpath(".//w:pBdr")):
            border.getparent().remove(border)

    styles["Normal"].font.size = Pt(10.3)
    styles["Normal"].paragraph_format.space_after = Pt(5)
    styles["Normal"].paragraph_format.line_spacing = 1.08
    styles["Title"].font.size = Pt(29)
    styles["Title"].font.bold = True
    styles["Title"].paragraph_format.space_after = Pt(10)
    styles["Subtitle"].font.size = Pt(12)
    styles["Subtitle"].font.color.rgb = RGBColor.from_string(GRAY)
    styles["Subtitle"].paragraph_format.space_after = Pt(12)
    styles["Heading 1"].font.size = Pt(18)
    styles["Heading 1"].font.bold = True
    styles["Heading 1"].paragraph_format.space_before = Pt(5)
    styles["Heading 1"].paragraph_format.space_after = Pt(7)
    styles["Heading 2"].font.size = Pt(12.5)
    styles["Heading 2"].font.bold = True
    styles["Heading 2"].paragraph_format.space_before = Pt(8)
    styles["Heading 2"].paragraph_format.space_after = Pt(3)
    styles["Heading 3"].font.size = Pt(10.5)
    styles["Heading 3"].font.bold = True
    styles["Heading 3"].paragraph_format.space_before = Pt(5)
    styles["Heading 3"].paragraph_format.space_after = Pt(2)
    styles["Caption"].font.size = Pt(8.5)
    styles["Caption"].font.italic = True
    styles["Caption"].font.color.rgb = RGBColor.from_string(GRAY)
    styles["Caption"].paragraph_format.space_before = Pt(3)
    styles["Caption"].paragraph_format.space_after = Pt(0)

    for section in doc.sections:
        footer = section.footer
        p = footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p.add_run("BuildTrack roles and access  |  ")
        add_page_field(p)
        for run in p.runs:
            run.font.name = "Aptos"
            run.font.size = Pt(8)
            run.font.color.rgb = RGBColor.from_string(GRAY)


def add_eyebrow(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text.upper())
    run.bold = True
    run.font.size = Pt(8.3)
    run.font.color.rgb = RGBColor.from_string(GREEN_2)
    set_keep_with_next(p)
    return p


def add_body(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    if bold_lead and text.startswith(bold_lead):
        p.add_run(bold_lead).bold = True
        p.add_run(text[len(bold_lead):])
    else:
        p.add_run(text)
    return p


def add_bullets(doc, items, compact=False):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.left_indent = Inches(0.2)
        p.paragraph_format.first_line_indent = Inches(-0.15)
        p.paragraph_format.space_after = Pt(2 if compact else 3)
        p.paragraph_format.line_spacing = 1.03 if compact else 1.08
        p.add_run(item)


def add_matrix(doc, headers, rows, widths):
    widths = [width * 7.06 / sum(widths) for width in widths]
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    set_repeat_table_header(table.rows[0])
    for index, (cell, text) in enumerate(zip(table.rows[0].cells, headers)):
        cell.width = Inches(widths[index])
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_fill(cell, GREEN)
        set_cell_margins(cell)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER if index > 0 else WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(8.8)
        run.font.color.rgb = RGBColor(255, 255, 255)
    for row_index, values in enumerate(rows):
        cells = table.add_row().cells
        for index, (cell, text) in enumerate(zip(cells, values)):
            cell.width = Inches(widths[index])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_fill(cell, "FFFFFF" if row_index % 2 == 0 else PALE_ALT)
            set_cell_margins(cell)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if index > 0 else WD_ALIGN_PARAGRAPH.LEFT
            run = p.add_run(text)
            run.font.size = Pt(8.5)
            if index == 0:
                run.bold = True
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(0)
    return table


def add_role_page(doc, role):
    doc.add_page_break()
    add_eyebrow(doc, role["family"])
    heading = doc.add_paragraph(role["name"], style="Heading 1")
    set_keep_with_next(heading)
    meta = doc.add_paragraph()
    meta.paragraph_format.space_after = Pt(5)
    r = meta.add_run(f"Scope  {role['scope']}    Role code  {role['code']}")
    r.bold = True
    r.font.size = Pt(9)
    r.font.color.rgb = RGBColor.from_string(GREEN_2)
    purpose = doc.add_paragraph(role["purpose"])
    purpose.paragraph_format.space_after = Pt(5)

    for label, key in (("Can do", "can"), ("Can view", "view"), ("Cannot do", "cannot")):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.keep_together = True
        p.add_run(f"{label}  ").bold = True
        p.add_run("; ".join(role[key]) + ".")

    image_p = doc.add_paragraph()
    image_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    image_p.paragraph_format.space_before = Pt(5)
    image_p.paragraph_format.space_after = Pt(0)
    image_p.paragraph_format.keep_with_next = True
    shape = image_p.add_run().add_picture(str(ASSETS / role["image"]), width=Inches(6.9))
    set_image_alt(shape, f"Representative BuildTrack screen for {role['name']}")
    caption = doc.add_paragraph(
        f"Representative screen for {role['name']}. Sample records are shown; navigation and action visibility reflect this role's permissions.",
        style="Caption",
    )
    caption.alignment = WD_ALIGN_PARAGRAPH.CENTER


roles = [
    {
        "name": "Super Admin", "family": "Platform role", "scope": "BuildTrack platform", "code": "separately provisioned",
        "purpose": "Operates the BuildTrack service and organization catalog without becoming a member of each customer's field workspace.",
        "can": ["onboard, suspend, and archive organizations", "manage contract pricing, platform defaults, shared role templates, and master catalogs", "review organization users and approved provider metadata"],
        "view": ["organization status, usage, invitations, user access, provider coverage, pricing, and platform activity"],
        "cannot": ["open tenant homes, work items, inspections, evidence, or conversations through platform privilege alone", "perform tenant work without a separate tenant membership and role"],
        "image": "super-admin.png",
    },
    {
        "name": "Org Admin", "family": "Organization administration", "scope": "Entire organization", "code": "org_admin",
        "purpose": "Owns tenant configuration, people, structure, vendors, quality workflows, reporting, and operational continuity.",
        "can": ["manage all organization roles, users, locations, floor plans, vendors, checklists, inspections, work, reports, audit, and settings", "grant scoped access and complete administrator handovers", "approve milestones and independently verify eligible corrections"],
        "view": ["all authorized tenant records across every division, neighborhood, home, vendor, inspection, report, and audit trail"],
        "cannot": ["remove or suspend the last active organization administrator", "verify their own correction or a same-company correction", "use platform-only organization, pricing, or global catalog controls unless separately provisioned"],
        "image": "org-admin.png",
    },
    {
        "name": "Divisional Admin", "family": "Location administration", "scope": "Assigned divisions", "code": "division_admin",
        "purpose": "Runs people, properties, vendors, standards, and field operations inside one or more delegated divisions.",
        "can": ["create and manage neighborhoods, homes, divisional floor plans, users, roles, vendors, checklists, inspections, work, reports, and audit within scope", "appoint division or neighborhood administrators within delegated authority", "extend approved vendor coverage only where their authority allows"],
        "view": ["operational and administrative records in assigned divisions and their child neighborhoods and homes"],
        "cannot": ["manage another division or grant organization-wide authority", "remove higher-level role or vendor coverage grants", "suspend a member across the organization or change platform controls"],
        "image": "divisional-admin.png",
    },
    {
        "name": "Area Construction Manager", "family": "Location administration", "scope": "Assigned neighborhoods", "code": "neighborhood_admin",
        "purpose": "Administers homes, local staff, vendors, checklists, inspections, repairs, and readiness for specific neighborhoods.",
        "can": ["add and maintain lots, homes, local access, vendor eligibility, checklist configuration, inspections, assignments, repairs, reports, and milestones in scope", "customize a home's copied plan and coordinate local escalations"],
        "view": ["people, homes, work, inspections, vendors, reports, and audit records for assigned neighborhoods"],
        "cannot": ["create divisions or maintain division master plans", "administer another neighborhood or expand their own scope", "remove parent-level access or vendor coverage grants"],
        "image": "area-manager.png",
    },
    {
        "name": "Construction Supervisor", "family": "Field operations", "scope": "Assigned divisions neighborhoods or homes", "code": "superintendent",
        "purpose": "Coordinates daily field work, inspection scheduling, correction review, and milestone readiness without receiving people administration by default.",
        "can": ["create, triage, assign, execute, and independently verify eligible work", "schedule and administer inspections", "use internal and shared comments, upload evidence, read reports, and approve milestones"],
        "view": ["scoped work queues, neighborhoods, inspection status, reports, and correction evidence"],
        "cannot": ["manage users, roles, organization structure, floor plans, vendor rosters, or global settings", "perform inspection checklists unless Inspector is also assigned", "bypass independent-verification rules"],
        "image": "construction-supervisor.png",
    },
    {
        "name": "Internal contributor", "family": "Field operations", "scope": "Assigned divisions neighborhoods or homes", "code": "internal_contributor",
        "purpose": "Reports issues and completes personally assigned internal work while keeping progress and evidence with the record.",
        "can": ["create work items", "perform assigned work", "post internal or shared comments and upload evidence"],
        "view": ["authorized work and home context in the assigned location scope", "their sync queue and shared project messages"],
        "cannot": ["assign or verify work", "schedule or perform inspections unless Inspector is added", "manage users, vendors, properties, reports, role catalogs, or settings"],
        "image": "internal-contributor.png",
    },
    {
        "name": "Inspector", "family": "Inspection role", "scope": "Assigned locations or own company with approved coverage", "code": "inspector",
        "purpose": "Completes assigned inspections and records checklist findings. This role is additive for internal staff or approved company users.",
        "can": ["perform assigned inspection checklists", "create findings, upload evidence, and use shared comments", "complete assigned reinspections when eligible"],
        "view": ["authorized inspection records, homes, checklist items, findings, and evidence required for the assignment"],
        "cannot": ["schedule or administer inspections solely through this role", "read internal-only comments", "dispatch repairs, administer users or vendors, or verify corrections solely because they inspected them"],
        "image": "inspector.png",
    },
    {
        "name": "Vendor Manager", "family": "Vendor company role", "scope": "Own company and approved coverage", "code": "vendor_admin",
        "purpose": "Manages the vendor company's BuildTrack users and dispatches company work to eligible personnel.",
        "can": ["invite and manage company users", "grant permitted company roles including Inspector", "delegate company repair and inspection assignments, add shared comments, and upload evidence"],
        "view": ["the company's authorized team, approved coverage, assigned work, shared conversations, and completion status"],
        "cannot": ["administer builder employees or unrelated companies", "expand or remove builder-controlled geographic coverage", "read internal comments, change organization settings, or verify same-company work"],
        "image": "vendor-manager.png",
    },
    {
        "name": "Vendor Tradesman", "family": "Vendor company role", "scope": "Own company and eligible assigned work", "code": "trade_technician",
        "purpose": "Completes vendor repairs assigned to the person or accountable company and submits evidence for independent review.",
        "can": ["acknowledge and perform assigned repairs", "report blockers", "post shared comments, upload evidence, and submit corrections"],
        "view": ["eligible assignments, work details, shared conversation history, and evidence for those assignments"],
        "cannot": ["manage company users or coverage", "view internal comments or unrelated company work", "assign or verify work, approve milestones, or inspect unless Inspector is also assigned"],
        "image": "vendor-tradesman.png",
    },
]


def build():
    doc = Document()
    configure_document(doc)

    # Cover
    logo = ROOT / "public" / "buildtrack-symbol-v2.png"
    if logo.exists():
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(18)
        shape = p.add_run().add_picture(str(logo), width=Inches(0.62))
        set_image_alt(shape, "BuildTrack logo")
    add_eyebrow(doc, "Product and access control reference")
    doc.add_paragraph("BuildTrack Main Roles and Access Reference", style="Title")
    doc.add_paragraph("The authoritative guide to who can see and do what in BuildTrack", style="Subtitle")
    add_body(doc, "This reference explains the BuildTrack project, the active role model, each role's powers and boundaries, and the screens that each persona uses. Product, design, engineering, operations, onboarding, and testing teams should use it as the starting point for access decisions.")
    add_body(doc, "The main rule is simple: a role never acts alone. Effective access requires an active identity, active organization membership, an enabled role, a valid scope, and any required assignment or vendor coverage. The database and transactional commands enforce the final decision even when the interface hides unavailable actions.")

    doc.add_paragraph("What BuildTrack is", style="Heading 1")
    add_body(doc, "BuildTrack is a mobile-responsive construction field operations and quality-management application. Internal teams, inspectors, and approved trade partners use it to record work, assign accountability, complete inspections, submit correction evidence, communicate about observations, and independently verify completion. Authorized field data can be downloaded for limited offline work and synchronized when connectivity returns.")
    doc.add_paragraph("How to use this reference", style="Heading 2")
    add_bullets(doc, [
        "Use the role pages to decide the minimum role and scope a person needs.",
        "Use the boundaries as acceptance criteria for navigation, API, database, and test behavior.",
        "Treat screenshots as representative product views. Actual records depend on the user's organization, scope, assignment, coverage, and current data.",
    ])
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(15)
    r = p.add_run("Version 1.0    5 November 2026")
    r.bold = True
    r.font.color.rgb = RGBColor.from_string(GREEN_2)

    # Access model
    doc.add_page_break()
    add_eyebrow(doc, "Access model")
    doc.add_paragraph("How access is calculated", style="Heading 1")
    add_body(doc, "BuildTrack combines identity, tenant membership, role permissions, location or company scope, and record-specific eligibility. If any required layer is missing or expired, the action is denied.")
    add_matrix(doc, ["Layer", "What it answers", "Examples"], [
        ("Identity", "Who signed in", "Supabase Auth identity and MFA level"),
        ("Membership", "Which tenant admits the person", "Active internal or external organization membership"),
        ("Role", "Which capabilities are available", "Org Admin, Inspector, Vendor Tradesman"),
        ("Scope", "Where the role applies", "Organization, division, neighborhood, home, or company"),
        ("Eligibility", "Which records may be acted on", "Assignment, inspection lead, vendor coverage, validity dates"),
        ("Workflow guard", "Whether this action is valid now", "State transition, version check, evidence, independence"),
    ], [1.15, 2.25, 3.95])
    doc.add_paragraph("Rules that apply to every role", style="Heading 2")
    add_bullets(doc, [
        "Least privilege. Grant the narrowest role and scope that supports the person's job.",
        "Additive roles. Inspector can be combined with an internal or vendor role; permissions add, but scope and workflow guards still apply.",
        "Hierarchy protection. A lower-level administrator cannot remove or weaken a grant issued from a higher level.",
        "Independent closure. A person cannot verify their own correction, and a company member cannot verify that company's correction.",
        "Server authority. Navigation is permission-aware, but row-level security and command functions are the enforcement boundary.",
        "Offline revalidation. Queued work synchronizes only if membership, scope, versions, and workflow conditions remain valid.",
    ], compact=True)

    # Overview
    doc.add_page_break()
    add_eyebrow(doc, "Role catalog")
    doc.add_paragraph("Active roles at a glance", style="Heading 1")
    add_body(doc, "The shipped catalog contains eight active organization role templates and one separately provisioned platform role. Organizations may create private roles, so custom access should be reviewed against the same principles.")
    add_matrix(doc, ["Role", "Primary scope", "Primary responsibility"], [
        ("Super Admin", "Platform", "Operate organizations, pricing, shared catalogs, and provider oversight"),
        ("Org Admin", "Organization", "Own tenant access, structure, standards, vendors, work, quality, and audit"),
        ("Divisional Admin", "Division", "Administer people and delivery across assigned divisions"),
        ("Area Construction Manager", "Neighborhood", "Run local properties, vendors, inspections, repairs, and readiness"),
        ("Construction Supervisor", "Location", "Coordinate work, inspections, correction review, and milestones"),
        ("Internal contributor", "Location", "Report issues and complete assigned internal work"),
        ("Inspector", "Location or company", "Perform assigned inspections and create findings"),
        ("Vendor Manager", "Company", "Manage company users and dispatch company assignments"),
        ("Vendor Tradesman", "Company work", "Complete assigned repairs and submit evidence"),
    ], [1.65, 1.4, 4.3])
    doc.add_paragraph("Navigation summary", style="Heading 2")
    add_matrix(doc, ["Role group", "Typical primary navigation"], [
        ("Platform", "Organizations and global settings and catalogs"),
        ("Tenant administrators", "Work, inspections, reports, properties, plans, vendors, administration, sync"),
        ("Construction Supervisor", "Work, neighborhoods, inspections, reports, sync"),
        ("Internal contributor", "Work, neighborhoods, sync"),
        ("Inspector", "Work findings, inspections, sync"),
        ("Vendor Manager", "Work, inspections, vendor management, administration, sync"),
        ("Vendor Tradesman", "Work and sync"),
    ], [2.0, 5.35])

    for role in roles:
        add_role_page(doc, role)

    # Governance
    doc.add_page_break()
    add_eyebrow(doc, "Governance")
    doc.add_paragraph("Role assignment and review", style="Heading 1")
    add_body(doc, "Administrators should assign roles by responsibility, then narrow them to the locations or company relationship required. Availability in the role catalog does not grant access by itself.")
    doc.add_paragraph("Onboarding sequence", style="Heading 2")
    add_bullets(doc, [
        "Confirm the person's organization relationship and whether the account is internal or external.",
        "Select the minimum role or additive role combination.",
        "Choose an allowed scope and confirm that the administrator can delegate it.",
        "For vendor users, confirm company membership and approved coverage. For inspectors, confirm the inspection assignment or engagement.",
        "Require MFA where the platform or administrative workflow demands it, then verify the resulting navigation and one representative action.",
    ])
    doc.add_paragraph("Periodic review", style="Heading 2")
    add_bullets(doc, [
        "Review active members, pending invitations, expiring grants, vendor coverage, and custom roles.",
        "Replace compatibility roles left from retired templates when a current role can express the same job.",
        "Remove local grants only through an administrator with matching authority; preserve historical work and audit records.",
        "Before a handover, establish and test the replacement administrator. BuildTrack prevents removal of the last active organization administrator.",
    ])
    doc.add_paragraph("Validation checklist", style="Heading 2")
    add_matrix(doc, ["Control", "Expected result"], [
        ("Navigation", "Only relevant areas and actions are presented"),
        ("Direct URL", "Unauthorized routes do not reveal protected data"),
        ("Database", "Row-level security restricts reads to effective scope"),
        ("Commands", "Writes reject invalid state, stale versions, missing evidence, or ineligible assignees"),
        ("Independence", "Self and same-company verification attempts are rejected"),
        ("Audit", "Role, scope, administrative, and workflow changes retain actor and time"),
        ("Offline", "Queued changes revalidate access and conflicts before synchronization"),
    ], [1.6, 5.75])
    doc.add_paragraph("Catalog note", style="Heading 2")
    add_body(doc, "Sales Rep is planned for the future.")

    # Ensure every section uses the same footer after page breaks.
    for section in doc.sections:
        section.footer.is_linked_to_previous = True

    doc.core_properties.title = "BuildTrack Main Roles and Access Reference"
    doc.core_properties.subject = "BuildTrack role powers, visibility, restrictions, and representative screens"
    doc.core_properties.author = "BuildTrack"
    doc.core_properties.keywords = "BuildTrack, roles, permissions, access control, screens"
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
