$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$windowPath = Join-Path $rootPath 'native/window/whale-window.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($windowPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Compile the actual embedded bridge as well as the native-region helper.
$sdk = Join-Path $rootPath 'native/window/sdk'
[void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')))
$source = [IO.File]::ReadAllText($windowPath)
$bridge = [regex]::Match($source, "(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
Add-Type -TypeDefinition $bridge -ReferencedAssemblies (Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $rootPath 'native/window/WhaleWindowRegion.cs')
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RegionTestNative {
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr r);
  [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr r,int x,int y);
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr w,IntPtr r);
  [DllImport("user32.dll")] public static extern int GetGuiResources(IntPtr p,int flag);
}
'@
$script:checks = 0
function Assert($condition, $message) {
  if (-not $condition) { throw $message }
  $script:checks++
}
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Left = -20000
$form.Top = -20000
$form.ClientSize = New-Object System.Drawing.Size(1000, 800)
$hwnd = $form.Handle
function Contains($x, $y) {
  $r = [RegionTestNative]::CreateRectRgn(0,0,0,0)
  try {
    [void][RegionTestNative]::GetWindowRgn($hwnd,$r)
    return [RegionTestNative]::PtInRegion($r,$x,$y)
  } finally { [void][RegionTestNative]::DeleteObject($r) }
}
try {
  Assert ([WhaleWindowRegion]::Clear($hwnd)) 'initial empty region'
  Assert (-not (Contains 100 100)) 'startup must not intercept desktop'
  foreach ($scale in @(1.0, 1.25, 1.5, 2.0)) {
    $vw = 1000 / $scale
    $vh = 800 / $scale
    $protocol = '"' + $vw.ToString([Globalization.CultureInfo]::InvariantCulture) + ',' + $vh.ToString([Globalization.CultureInfo]::InvariantCulture) + ';10,20,110,120;200,100,300,200"'
    Assert ([WhaleWindowRegion]::Apply($hwnd,$protocol)) "apply at $scale scale/zoom"
    Assert (Contains ([int](30*$scale)) ([int](40*$scale))) 'whale accepts input'
    Assert (Contains ([int](230*$scale)) ([int](140*$scale))) 'detached panel accepts input'
    Assert (-not (Contains ([int](150*$scale)) ([int](100*$scale)))) 'desktop gap excluded'
    Assert (-not (Contains 990 790)) 'distant desktop excluded'
  }
  foreach ($bad in @('null','""','"0,800"','"NaN,800"','"1000,800;0,0,1000,800"','"1000,800;10,20,Infinity,30"','"1000,800;1,2,3"')) {
    Assert (-not [WhaleWindowRegion]::Apply($hwnd,$bad)) "reject malformed/fullscreen: $bad"
    Assert ([WhaleWindowRegion]::Clear($hwnd)) 'host failure path clears region'
    Assert (-not (Contains 30 40)) 'failed snapshot leaves desktop free'
  }
  Assert ([WhaleWindowRegion]::Apply($hwnd,'"1000,800;-20,-10,50,60;950,750,1100,900"')) 'clip offscreen surfaces'
  Assert (Contains 0 0) 'partly offscreen widget retained'
  Assert (-not (Contains 500 400)) 'offscreen surfaces do not expand to viewport'
  $processHandle = [Diagnostics.Process]::GetCurrentProcess().Handle
  $before = [RegionTestNative]::GetGuiResources($processHandle,0)
  for ($i=0; $i -lt 1000; $i++) {
    if (-not [WhaleWindowRegion]::Apply($hwnd,'"1000,800;10,20,110,120;200,100,300,200"')) { throw 'repeated region apply' }
  }
  $after = [RegionTestNative]::GetGuiResources($processHandle,0)
  Assert (($after-$before) -le 2) 'no GDI region leak across 1000 updates'
  Write-Output "PASS: $script:checks native/parse/compile checks; 1000 region updates; GDI delta $($after-$before)"
} finally { $form.Dispose() }
