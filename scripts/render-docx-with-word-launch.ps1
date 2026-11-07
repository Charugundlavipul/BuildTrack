param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$PdfToPpmPath
)

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$workspace = [System.IO.Path]::GetFullPath((Get-Location).Path)
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
if (-not $resolvedOutput.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output directory must stay inside the workspace.'
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$pdfPath = Join-Path $resolvedOutput 'BuildTrack Main Roles and Access Reference.pdf'
$wordPath = 'C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE'
$process = Start-Process -FilePath $wordPath -ArgumentList @('/q', '/safe', ('"' + $resolvedInput + '"')) -WindowStyle Hidden -PassThru
$word = $null
try {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $word = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
      if ($word.Documents.Count -gt 0 -and $word.ActiveDocument.FullName -eq $resolvedInput) { break }
    } catch {}
    Start-Sleep -Milliseconds 750
  }
  if ($null -eq $word -or $word.Documents.Count -eq 0 -or $word.ActiveDocument.FullName -ne $resolvedInput) { throw 'Word did not open the document for rendering.' }
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.ActiveDocument
  $document.ExportAsFixedFormat($pdfPath, 17)
  $document.Close($false)
  $word.Quit()
} finally {
  if ($null -ne $word) { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}

& $PdfToPpmPath -png -r 144 $pdfPath (Join-Path $resolvedOutput 'page')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-ChildItem -LiteralPath $resolvedOutput -Filter 'page-*.png' | Sort-Object Name | Select-Object -ExpandProperty FullName
