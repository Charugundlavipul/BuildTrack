from pathlib import Path
from zipfile import ZipFile
from lxml import etree

path = Path(__file__).resolve().parents[1] / 'docs' / 'BuildTrack Main Roles and Access Reference.docx'
with ZipFile(path) as archive:
    entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
root = etree.fromstring(dict((i.filename, data) for i, data in entries)['word/document.xml'])
matches = [p for p in root.findall('.//w:p', ns) if ''.join(p.itertext()).startswith('Sales Rep is planned and inactive.')]
assert len(matches) == 1, f'Expected one target paragraph, found {len(matches)}'
texts = matches[0].findall('.//w:t', ns)
texts[0].text = 'Sales Rep is planned for the future.'
for text in texts[1:]:
    text.text = ''
xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
temporary = path.with_suffix('.updated.docx')
with ZipFile(temporary, 'w') as archive:
    for info, data in entries:
        archive.writestr(info, xml if info.filename == 'word/document.xml' else data)
with ZipFile(temporary) as archive:
    assert archive.testzip() is None
    assert b'Sales Rep is planned for the future.' in archive.read('word/document.xml')
temporary.replace(path)
print(path)
