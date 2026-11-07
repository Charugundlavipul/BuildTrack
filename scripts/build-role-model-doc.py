from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT

root = Path(__file__).resolve().parents[1]
doc = Document()
section = doc.sections[0]
section.top_margin = section.bottom_margin = Inches(.65)
section.left_margin = section.right_margin = Inches(.7)
section.page_width = Inches(8.5)
section.page_height = Inches(11)
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2']:
    style = doc.styles[name]
    style.font.name = 'Calibri'
    style.font.color.rgb = RGBColor(0, 0, 0)
    for border in list(style.element.xpath('.//w:pBdr')):
        border.getparent().remove(border)
doc.styles['Normal'].font.size = Pt(10)
doc.styles['Normal'].paragraph_format.space_after = Pt(6)
doc.styles['Normal'].paragraph_format.line_spacing = 1.06
doc.styles['Title'].font.size = Pt(24)
doc.styles['Heading 1'].font.size = Pt(14)
doc.styles['Heading 1'].paragraph_format.space_before = Pt(12)
doc.styles['Heading 1'].paragraph_format.space_after = Pt(6)

def p(text, style=None):
    return doc.add_paragraph(text, style)

def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for i, width in enumerate(widths):
        t.columns[i].width = Inches(width)
    for cell, text in zip(t.rows[0].cells, headers):
        cell.text = text
    for row in rows:
        cells = t.add_row().cells
        for cell, text in zip(cells, row):
            cell.text = text
    borders = OxmlElement('w:tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:
        edge = OxmlElement('w:' + side)
        edge.set(qn('w:val'),'single'); edge.set(qn('w:sz'),'4'); edge.set(qn('w:color'),'D9D9D9')
        borders.append(edge)
    t._tbl.tblPr.append(borders)
    for ri, row in enumerate(t.rows):
        pr = row._tr.get_or_add_trPr()
        if ri == 0: pr.append(OxmlElement('w:tblHeader'))
        pr.append(OxmlElement('w:cantSplit'))
        for ci, cell in enumerate(row.cells):
            cell.width = Inches(widths[ci])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tcpr = cell._tc.get_or_add_tcPr()
            shade = OxmlElement('w:shd'); shade.set(qn('w:fill'), '263B49' if ri == 0 else ('F2F5F7' if ri % 2 == 0 else 'FFFFFF')); tcpr.append(shade)
            margins = OxmlElement('w:tcMar')
            for side in ['top','left','bottom','right']:
                item = OxmlElement('w:' + side); item.set(qn('w:w'),'85'); item.set(qn('w:type'),'dxa'); margins.append(item)
            tcpr.append(margins)
            for para in cell.paragraphs:
                para.paragraph_format.space_after = Pt(2)
                for run in para.runs:
                    run.font.size = Pt(9.5)
                    if ri == 0: run.bold = True; run.font.color.rgb = RGBColor(255,255,255)
    p('') .paragraph_format.space_after = Pt(0)
    return t

p('BuildTrack roles and access', 'Title')
p('Product manager review   |   26 October 2026', 'Subtitle')
p('This document defines the new organization, division, neighborhood, and vendor administration model. Access follows the location hierarchy; vendor ownership is separate from where a vendor may work. Implementation and migration are being verified against these rules.')
p('Administrative responsibilities', 'Heading 1')
table(['Role','Where it applies','Responsibilities'], [
 ('Organization admin','Entire organization','Full tenant administration and operations. Create divisions, appoint admins, manage users, configure roles and settings, onboard vendors, and expand or revoke access anywhere in the organization.'),
 ('Division admin','One or more assigned divisions','Manage division details, create neighborhoods and homes, invite users, assign permitted roles inside those divisions, onboard vendors, and extend vendors across authorized neighborhoods and divisions.'),
 ('Neighborhood admin','One or more assigned neighborhoods','Manage homes and local operations, invite users and vendor admins, assign permitted local roles, and onboard vendors for the assigned neighborhoods. Cannot create divisions or expand beyond assigned areas.'),
 ('Vendor admin','Own company and its approved coverage','Invite and manage the company’s users and manage its assigned work. Cannot administer builder employees, other vendors, or expand company coverage.')
], [1.22,1.35,4.53])
p('Delegation and removal', 'Heading 1')
p('Admins may grant only roles and locations within their own authority. A division admin may appoint another division admin within an assigned division or a neighborhood admin beneath it. A neighborhood admin may appoint local admins and staff. Nobody may grant organization authority unless they hold organization authority.')
p('Higher-level grants are protected. Lower admins can remove local access they control, but cannot remove a parent-level grant, suspend a person organization-wide, deactivate an inherited vendor, or alter another division. Vendor admins can remove only company relationships they are authorized to manage; builder-granted relationships remain protected.')
p('Vendor example', 'Heading 1')
p('Neighborhood A onboards a vendor. Its division admin adds Neighborhood B. An organization admin adds a second division. The original neighborhood admin can manage eligible local entries it controls, but cannot remove either higher-level grant or deactivate the company globally. Existing work and history are retained.')

doc.add_page_break()
p('Operational responsibilities', 'Heading 1')
p('Administrative authority and day-to-day duties are separate. Staff receive the least access required; organization and location admins inherit operations within their authorized areas. Independent verification rules still prevent self-approval.')
table(['Role','Main duties'], [
 ('Field manager','Create, assign, schedule, perform assigned work, review corrections, manage inspections and milestones within scope. Replaces the Superintendent label without automatically granting people administration.'),
 ('Field coordinator','Create and assign work, schedule inspections, and coordinate follow-up. Does not approve corrections or manage users.'),
 ('Field contributor','Report issues, perform assigned work, add evidence and shared or internal comments.'),
 ('Internal inspector','Complete checklists and record findings; read authorized work and internal comments.'),
 ('External inspector','Perform authorized inspections and submit findings with shared comments. No broad internal work access or internal comments.'),
 ('Independent verifier','Review and approve eligible corrections within scope. Cannot approve their own work or same-company corrections.'),
 ('Vendor technician','Perform personally assigned vendor work and add shared comments and evidence. No company administration.'),
 ('Viewer and optional Auditor','Viewer reads authorized work and reports. Auditor additionally reads access and change history; it is an optional specialized role.')
], [1.42,5.68])
p('Obsolete role cleanup', 'Heading 1')
p('Retire Area construction manager, Assistant superintendent, and Trade company manager from new assignments. Vendor admin replaces Trade company manager. Assistant superintendent maps to Field coordinator plus Field contributor, preserving its existing operational permissions. Area manager grants, if any remain at migration, receive an exact-permission compatibility role rather than new administrative powers.')
p('Rename Superintendent to Field manager, Operations coordinator to Field coordinator, Internal quality inspector to Internal inspector, Trade technician to Vendor technician, and Leadership viewer to Viewer. Renaming retains their existing permission boundaries. Existing organization-specific roles remain available to their organization.')
p('Implementation safeguards', 'Heading 1')
p('Record who granted each role, its location, authority level, validity dates, and vendor ownership. Recheck invitations when accepted. Prevent the last organization admin from being removed. Audit access changes, preserve historical records, and enforce every scope and hierarchy rule in the database as well as the UI. Platform administration remains separate from tenant administration.')

def workflow(title, steps):
    doc.add_heading(title, level=2)
    for label, detail in steps:
        para = doc.add_paragraph()
        para.add_run(label + ' ').bold = True
        para.add_run(detail)

doc.add_page_break()
p('Daily workflows for administrators', 'Heading 1')
p('Use these workflows as the operating model for onboarding and product review. Admins see only their authorized areas; broader access must come from an authorized parent admin.')
workflow('Organization admin', [
 ('Start of day', 'Review overdue work, unresolved blockers, inspection exceptions, and user or vendor access changes across divisions. Identify issues that need division owners.'),
 ('Set up and delegate', 'Create divisions, appoint division admins, establish organization standards, and enable shared roles or create organization-specific roles. Invite a replacement organization admin before handing over access.'),
 ('Resolve cross division needs', 'Extend an existing vendor into additional divisions, resolve access disputes, and approve changes beyond a division admin’s authority. Use the same vendor record to preserve its team and history.'),
 ('Close the loop', 'Review escalations and the audit trail. Suspend users organization-wide or deactivate a vendor only after active work is reassigned or completed. Platform account blocking and contract pricing stay with platform operators.')
])
workflow('Division admin', [
 ('Start of day', 'Compare assigned neighborhoods: overdue corrections, unacknowledged assignments, inspection schedules, and homes approaching milestones.'),
 ('Set up the division', 'Maintain division details, create neighborhoods and homes, appoint neighborhood admins, and invite staff with the minimum roles and locations needed.'),
 ('Coordinate delivery', 'Rebalance work inside authorized divisions, onboard categorized vendors, invite vendor admins, and expand coverage to other neighborhoods or divisions that this admin also controls. Add neighborhood eligibility before assigning vendor work.'),
 ('Escalate and review', 'Resolve neighborhood blockers and review reports. Ask the organization admin for another division or protected grant. Remove only grants this admin is allowed to control; never suspend a user across the organization.')
])
workflow('Neighborhood admin', [
 ('Start of day', 'Review the neighborhood’s homes, open issues, vendor responses, today’s inspections, and milestone risks.'),
 ('Set up local work', 'Create and update homes and rooms. Invite local staff and assign scoped roles. Onboard categorized vendors, invite their admins, and authorize neighborhood eligibility within approved coverage.'),
 ('Run the day', 'Create or assign work to an eligible internal person or vendor, set due dates, arrange inspections, and follow up on blockers. Verify corrections only when independence rules allow it.'),
 ('Escalate and close', 'Request division help for capacity, wider vendor coverage, or protected access. Remove permitted local grants while retaining the person’s other access and all historical records.')
])

doc.add_page_break()
p('Daily workflows for company and field teams', 'Heading 1')
workflow('Vendor admin', [
 ('Plan', 'Review work assigned to the company across approved coverage and check due dates, access instructions, materials, and technician capacity.'),
 ('Assign and support', 'Invite company users, grant permitted company roles, and delegate company assignments to eligible technicians. Acknowledge work, update progress, and flag blockers. Builder-granted company relationships remain protected.'),
 ('Complete and follow up', 'Check the correction and its evidence before requesting verification. Track accepted and returned corrections. Ask a builder admin for wider coverage or changes to protected grants; the vendor admin cannot add regions themselves.')
])
workflow('Field manager', [
 ('Plan and assign', 'Review scoped open work and upcoming inspections. Create and assign ordinary work directly, select an eligible person or vendor, and set due dates. Saved drafts may be finished later.'),
 ('Deliver and check', 'Perform personally assigned tasks, resolve blockers, coordinate inspections, and review ready corrections when independent. Approve milestones only after required work and inspections are complete.'),
 ('Hand off', 'Escalate staffing, vendor coverage, and user-access requests to the appropriate admin. This role does not grant people-management authority.')
])
workflow('Field coordinator', [
 ('Coordinate', 'Review incoming submitted issues, clarify location and required trade, create or assign work, schedule inspections, and follow up on due dates and blockers.'),
 ('Hand off', 'Send completion reviews to a field manager or independent verifier. Send personnel and access changes to an admin. The coordinator cannot perform assigned work, approve corrections, or manage users unless separately granted those duties.')
])
workflow('Field contributor', [
 ('Capture', 'Identify the home or room, describe the issue, attach evidence, and save a draft. Submit the item when ready for a manager or coordinator to review and assign.'),
 ('Perform', 'Acknowledge assigned work, start it, update progress, and explain blockers. Complete the correction and add evidence before requesting verification. Respond to returned corrections; do not approve your own work.')
])
workflow('Vendor technician', [
 ('Perform assigned work', 'Review personal assignments, acknowledge them, confirm site access and materials, and start work. Use shared comments to communicate with the builder and company admin.'),
 ('Submit the correction', 'Add completion evidence and request verification. Resolve blockers through the vendor admin and respond to rework requests. Other technicians’ work, internal comments, user administration, and vendor coverage are outside this role.')
])

doc.add_page_break()
p('Daily workflows for inspection and review', 'Heading 1')
workflow('Internal inspector', [
 ('Prepare', 'Open the assigned inspection, confirm the home and checklist, and review previous findings within scope.'),
 ('Inspect and submit', 'Record pass, fail, not applicable, or not checked for checklist questions. Explain exceptions and create findings for failures. Complete required responses and submit the inspection; its findings then become available for assignment.'),
 ('Follow up', 'Review corrections through the next authorized inspection or reinspection. An inspector does not gain independent work-verification permission solely by being an inspector.')
])
workflow('External inspector', [
 ('Prepare', 'Accept the invitation and complete the profile. Work only on authorized inspections within the engagement’s home and validity period.'),
 ('Inspect and submit', 'Complete the checklist and record findings and evidence through shared channels. Submit the inspection for the builder’s follow-up. Internal comments, unrelated work, user administration, and vendor management remain unavailable.'),
 ('Request an extension', 'Ask the assigning admin if the engagement expires or another home needs inspection; do not change the engagement or your own scope.')
])
workflow('Independent verifier', [
 ('Review', 'Open corrections awaiting verification, compare the original issue with the correction and evidence, and confirm that the work meets the stated requirement.'),
 ('Decide', 'Accept the correction or return it with an actionable explanation. Self-verification and same-company verification are rejected. Request another eligible verifier when independence cannot be met.'),
 ('Hand off', 'Return incomplete work to the assignee and escalate disputes to the authorized field manager or admin. This role does not assign work or manage users.')
])
workflow('Viewer and Auditor', [
 ('Viewer', 'Read authorized work, status, overdue trends, and reports. Use the findings for operational review and ask the responsible manager for follow-up. No creation, assignment, editing, or approval.'),
 ('Auditor', 'Perform the read-only review above and inspect the access and change history: who granted access, who changed scope, and which administrative actions occurred. Report exceptions to the organization admin; do not alter the records.')
])
p('End to end handoff', 'Heading 1')
p('A contributor reports an issue and submits it. A coordinator, field manager, or location admin reviews and assigns it. A vendor admin delegates company work to a technician. The assignee acknowledges, performs, and submits a correction with evidence. An eligible independent verifier accepts it or requests rework. Inspectors submit inspection findings through their inspection before those findings are assigned. Authorized managers and admins review milestones after the required work and inspections are complete.')
p('When the device is offline', 'Heading 1')
p('Open needed homes while connected so the app can save their authorized data. Supported drafts, comments, checklist responses, and evidence remain queued on the device during an outage and sync when connectivity returns while the app is open. Assignment, administration, and final server checks require a connection. Conflicting changes remain available for review instead of overwriting newer work.')

footer = section.footer.paragraphs[0]
footer.alignment = 2
footer.add_run('BuildTrack  |  Role model  |  ')
field = OxmlElement('w:fldSimple'); field.set(qn('w:instr'),'PAGE'); footer._p.append(field)
for run in footer.runs: run.font.size = Pt(8)
out = root / 'docs' / 'BuildTrack Roles and Responsibilities.docx'
doc.save(out)
print(out)
