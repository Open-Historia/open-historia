# Regenerates the fork beta's branding: every logo the app shows, with a BETA
# banner composited across the bottom. Run it from the repo root when the upstream
# artwork changes; the outputs are committed, so nothing in a build depends on it.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-beta-icons.ps1
#
# Windows-only (System.Drawing) because that is where this fork is developed. The
# outputs are ordinary PNGs — regenerating them any other way is fine.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "electron\beta-assets"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# source -> output. icon-512 is also the installer icon (electron-builder.beta.yml).
$jobs = @(
  @{ src = "public\icon-512.png"; out = "icon-beta.png" },
  @{ src = "public\logo.png";     out = "logo-beta.png" },
  @{ src = "public\icon-192.png"; out = "icon-192-beta.png" }
)

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

foreach ($job in $jobs) {
  $src = Join-Path $root $job.src
  $dst = Join-Path $outDir $job.out
  $base = [System.Drawing.Image]::FromFile($src)
  $w = $base.Width; $h = $base.Height
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.DrawImage($base, 0, 0, $w, $h)

  # Fractions of the canvas, so every size gets the same proportions.
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
    [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
    [System.Drawing.Color]::FromArgb(255, 109, 40, 217))
  $g.FillPath($fill, $path)
  $penW = [Math]::Max(1.0, [float]($h * 0.012))
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 46, 16, 101), $penW)), $path)

  # Grow the type until it fills ~72% of the banner width or hits its height.
  $text = "BETA"
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
  "$($job.src) -> electron/beta-assets/$($job.out)  (${w}x${h}, ${size}px type)"
}
