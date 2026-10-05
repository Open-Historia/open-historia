# Regenerates the Android beta app's launcher icons: the app's own icons with the
# BETA banner the desktop beta wears (scripts/make-beta-icon.ps1). Run it from the
# repo root when the Android icons change; the output is committed, so nothing in
# a build depends on this script having been run.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-android-beta-icons.ps1
#
# The beta installs beside the stable app, and a launcher shows both under names
# that share a prefix ("Open Historia", "Open Historia Beta"), cut short on a
# phone's home screen; the banner is what tells a tester which one they are
# opening. Three images per density, next to the stable ones in mobile/android/
# app/src/main/res/mipmap-*:
#
#   ic_launcher_beta.png             from ic_launcher.png (square, older Androids)
#   ic_launcher_beta_round.png       from ic_launcher_round.png (round launchers)
#   ic_launcher_beta_foreground.png  from ic_launcher_foreground.png (the adaptive
#                                    icon's layer; mipmap-anydpi-v26 insets it by
#                                    16.7%, and the banner stays inside a circle)
#
# The build picks them by channel (android.defaultConfig manifestPlaceholders in
# mobile/android/app/build.gradle). Windows-only (System.Drawing), like the
# desktop script; the output is ordinary PNGs.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root "mobile\android\app\src\main\res"

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

# The banner, placed by fractions of the image: top, height and side margin.
function Add-BetaBanner($src, $dst, $top, $height, $side) {
  $base = [System.Drawing.Image]::FromFile($src)
  $w = $base.Width; $h = $base.Height
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.DrawImage($base, 0, 0, $w, $h)

  $barH = [Math]::Max(3, [int]($h * $height))
  $barY = [int]($h * $top)
  $barX = [int]($w * $side)
  $barW = $w - (2 * $barX)
  $radius = [Math]::Max(1, [int]($barH * 0.30))

  $shadow = New-RoundedRect $barX ($barY + [Math]::Max(1, [int]($h * 0.012))) $barW $barH $radius
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 0, 0, 0))), $shadow)
  $path = New-RoundedRect $barX $barY $barW $barH $radius
  $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point($barX, $barY)),
    (New-Object System.Drawing.Point($barX, ($barY + $barH))),
    [System.Drawing.Color]::FromArgb(255, 139, 92, 246),
    [System.Drawing.Color]::FromArgb(255, 109, 40, 217))
  $g.FillPath($fill, $path)
  $penW = [Math]::Max(0.75, [float]($h * 0.012))
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 46, 16, 101), $penW)), $path)

  # Grow the type until it fills ~72% of the banner width or hits its height.
  $text = "BETA"
  $target = $barW * 0.72
  $size = 3.0
  for ($i = 0; $i -lt 200; $i++) {
    $probe = New-Object System.Drawing.Font("Segoe UI", ($size + 0.5), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $m = $g.MeasureString($text, $probe)
    $probe.Dispose()
    if ($m.Width -gt $target -or ($size + 0.5) -gt ($barH * 0.95)) { break }
    $size += 0.5
  }
  $font = New-Object System.Drawing.Font("Segoe UI", $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF($barX, $barY, $barW, $barH)), $fmt)

  $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $base.Dispose(); $font.Dispose()
}

$densities = Get-ChildItem -Path $res -Directory -Filter "mipmap-*" | Where-Object { $_.Name -notlike "*anydpi*" }
foreach ($dir in $densities) {
  $d = $dir.FullName
  # The square icon: the desktop beta's banner, low across the compass.
  Add-BetaBanner (Join-Path $d "ic_launcher.png") (Join-Path $d "ic_launcher_beta.png") 0.70 0.215 0.045
  # The round one: higher and narrower, so the banner's ends stay inside the circle.
  Add-BetaBanner (Join-Path $d "ic_launcher_round.png") (Join-Path $d "ic_launcher_beta_round.png") 0.63 0.19 0.13
  # The adaptive layer: drawn into the inner two thirds of the icon, where the
  # desktop geometry lands inside any launcher's mask.
  Add-BetaBanner (Join-Path $d "ic_launcher_foreground.png") (Join-Path $d "ic_launcher_beta_foreground.png") 0.70 0.215 0.045
  "$($dir.Name): ic_launcher_beta, ic_launcher_beta_round, ic_launcher_beta_foreground"
}
