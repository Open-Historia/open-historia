# Regenerates the beta build's icon: the app compass with a BETA banner across the
# bottom. Run it from the repo root when public/icon-512.png changes; the output is
# committed, so nothing in a build depends on this script having been run.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-beta-icon.ps1
#
# The icon matters more than the name. Windows truncates the Start Menu and taskbar
# labels of two apps whose names share a prefix, so "Open Historia" and "Open
# Historia Beta" can render identically there — the artwork is what tells a tester
# which one they are launching.
#
# Windows-only (System.Drawing), which is where this is developed. The output is an
# ordinary PNG; regenerating it any other way is fine.
#
# The multiplayer build's icon is the same banner in another colour and word:
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-beta-icon.ps1 -Text MULTIPLAYER `
#     -OutFile electron\multiplayer-assets\icon-multiplayer.png -Top "22,160,210" -Bottom "10,112,160" -Edge "5,60,90"
#
# Colours are "r,g,b" text: -File hands every argument over as a string.
param(
  [string]$Text = "BETA",
  [string]$OutFile = "electron\beta-assets\icon-beta.png",
  [string]$Top = "139,92,246",
  [string]$Bottom = "109,40,217",
  [string]$Edge = "46,16,101"
)
$topRgb = @($Top.Split(",") | ForEach-Object { [int]$_ })
$bottomRgb = @($Bottom.Split(",") | ForEach-Object { [int]$_ })
$edgeRgb = @($Edge.Split(",") | ForEach-Object { [int]$_ })
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $root $OutFile
$outDir = Split-Path -Parent $dst
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$src = Join-Path $root "public\icon-512.png"

function New-RoundedRect($x, $y, $ww, $hh, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $ww - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $ww - $d, $y + $hh - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $hh - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$base = [System.Drawing.Image]::FromFile($src)
$w = $base.Width; $h = $base.Height
$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.DrawImage($base, 0, 0, $w, $h)

# Fractions of the canvas, so the proportions survive any source size.
$barH = [int]($h * 0.215)
$barY = [int]($h * 0.700)
$barX = [int]($w * 0.045)
$barW = $w - (2 * $barX)
$radius = [Math]::Max(2, [int]($barH * 0.30))

$shadow = New-RoundedRect $barX ($barY + [Math]::Max(1, [int]($h * 0.012))) $barW $barH $radius
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 0, 0, 0))), $shadow)

$path = New-RoundedRect $barX $barY $barW $barH $radius
$fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point($barX, $barY)),
  (New-Object System.Drawing.Point($barX, ($barY + $barH))),
  [System.Drawing.Color]::FromArgb(255, $topRgb[0], $topRgb[1], $topRgb[2]),
  [System.Drawing.Color]::FromArgb(255, $bottomRgb[0], $bottomRgb[1], $bottomRgb[2]))
$g.FillPath($fill, $path)
$penW = [Math]::Max(1.0, [float]($h * 0.012))
$g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, $edgeRgb[0], $edgeRgb[1], $edgeRgb[2]), $penW)), $path)

# Grow the type until it fills ~72% of the banner width or hits its height.
$text = $Text
$target = $barW * 0.72
$size = 6.0
for ($i = 0; $i -lt 80; $i++) {
  $probe = New-Object System.Drawing.Font("Segoe UI", ($size + 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $m = $g.MeasureString($text, $probe)
  $probe.Dispose()
  if ($m.Width -gt $target -or ($size + 1) -gt ($barH * 0.95)) { break }
  $size += 1
}
$font = New-Object System.Drawing.Font("Segoe UI", $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString($text, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF($barX, $barY, $barW, $barH)), $fmt)

$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $base.Dispose(); $font.Dispose()
"public/icon-512.png -> $OutFile  (${w}x${h}, ${size}px type)"
