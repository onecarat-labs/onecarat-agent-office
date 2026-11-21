# Helper of check-app.mjs: looks at (and moves / closes) the top-level windows of ONE process, given by its id.
# It is only ever given the id of the test instance that check-app.mjs started itself.
#   win.ps1 list  <pid>                 -> JSON: windows of that process, the work area, who has the keyboard
#   win.ps1 move  <hwnd> <x> <y> <w> <h>
#   win.ps1 close <hwnd>                 (the same as pressing the window's close button)
#   win.ps1 minimize <hwnd>              (the same as pressing its minimize button: into the taskbar)
#   win.ps1 restore  <hwnd>              (the same as bringing it back from the taskbar)
param([string]$cmd, [string]$a1, [string]$a2, [string]$a3, [string]$a4, [string]$a5)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OfficeWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, out RECT r, uint c);
  public static List<IntPtr> Of(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
'@
[void][OfficeWin]::SetProcessDPIAware()

if ($cmd -eq 'list') {
  $wins = @()
  foreach ($h in [OfficeWin]::Of([uint32]$a1)) {
    $r = New-Object OfficeWin+RECT; [void][OfficeWin]::GetWindowRect($h, [ref]$r)
    $c = New-Object OfficeWin+RECT; [void][OfficeWin]::GetClientRect($h, [ref]$c)
    $sb = New-Object System.Text.StringBuilder 512; [void][OfficeWin]::GetWindowText($h, $sb, 512)
    $cn = New-Object System.Text.StringBuilder 256; [void][OfficeWin]::GetClassName($h, $cn, 256)
    $ex = [OfficeWin]::GetWindowLongPtr($h, -20).ToInt64()
    $st = [OfficeWin]::GetWindowLongPtr($h, -16).ToInt64()
    $wins += [pscustomobject]@{
      hwnd = $h.ToInt64(); title = $sb.ToString(); x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top
      clientW = $c.Right; clientH = $c.Bottom; className = $cn.ToString(); exStyle = $ex; style = $st
      topmost = (($ex -band 0x8) -ne 0); resizable = (($st -band 0x40000) -ne 0)
      minimizeBox = (($st -band 0x20000) -ne 0); maximizeBox = (($st -band 0x10000) -ne 0); minimized = [OfficeWin]::IsIconic($h)
    }
  }
  $wa = New-Object OfficeWin+RECT; [void][OfficeWin]::SystemParametersInfo(0x30, 0, [ref]$wa, 0)
  $fg = [OfficeWin]::GetForegroundWindow(); $fp = 0; [void][OfficeWin]::GetWindowThreadProcessId($fg, [ref]$fp)
  [pscustomobject]@{ windows = @($wins); work = [pscustomobject]@{ x = $wa.Left; y = $wa.Top; w = $wa.Right - $wa.Left; h = $wa.Bottom - $wa.Top }; foregroundPid = $fp; foregroundHwnd = $fg.ToInt64() } | ConvertTo-Json -Depth 4 -Compress
} elseif ($cmd -eq 'move') {
  [void][OfficeWin]::MoveWindow([IntPtr][int64]$a1, [int]$a2, [int]$a3, [int]$a4, [int]$a5, $true)
} elseif ($cmd -eq 'close') {
  [void][OfficeWin]::PostMessage([IntPtr][int64]$a1, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
} elseif ($cmd -eq 'minimize') {
  [void][OfficeWin]::PostMessage([IntPtr][int64]$a1, 0x112, [IntPtr]0xF020, [IntPtr]::Zero)
} elseif ($cmd -eq 'restore') {
  [void][OfficeWin]::PostMessage([IntPtr][int64]$a1, 0x112, [IntPtr]0xF120, [IntPtr]::Zero)
} else {
  throw "unknown command: $cmd"
}
