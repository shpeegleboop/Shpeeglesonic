# Capture a window to PNG without touching mouse or keyboard.
#
# PrintWindow needs flag 2 (PW_RENDERFULLCONTENT) to capture WebView2 content;
# without it the client area comes back blank, which looks exactly like the bug
# you would be investigating.
#
#   powershell -File scripts/capture.ps1 -ProcessName shpeeglesonic -Out shot.png
param(
  [string]$ProcessName = 'shpeeglesonic',
  [string]$Out = 'capture.png'
)

Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $sig

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $proc) { Write-Error "no window for process '$ProcessName'"; exit 1 }

$h = $proc.MainWindowHandle
$r = New-Object Win32Cap+RECT
[void][Win32Cap]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L
$ht = $r.B - $r.T
if ($w -le 0 -or $ht -le 0) { Write-Error "bad window rect ${w}x${ht}"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT
[void][Win32Cap]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "wrote $Out (${w}x${ht})"
