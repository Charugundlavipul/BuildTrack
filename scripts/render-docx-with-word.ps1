param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$PdfToPpmPath
)

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
if (-not $resolvedOutput.StartsWith([System.IO.Path]::GetFullPath((Get-Location).Path), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output directory must stay inside the workspace.'
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$pdfPath = Join-Path $resolvedOutput 'BuildTrack Main Roles and Access Reference.pdf'

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $document = $word.Documents.Open($resolvedInput, $false, $true)
  try {
    $document.ExportAsFixedFormat($pdfPath, 17)
  } finally {
    $document.Close($false)
  }
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
}

& $PdfToPpmPath -png -r 144 $pdfPath (Join-Path $resolvedOutput 'page')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-ChildItem -LiteralPath $resolvedOutput -Filter 'page-*.png' | Select-Object -ExpandProperty FullName
