param([int]$X,[int]$Y,[switch]$Click)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IslandPointerTest {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[void][IslandPointerTest]::SetProcessDpiAwarenessContext([IntPtr](-4))
[void][IslandPointerTest]::SetCursorPos($X,$Y)
if($Click){
  Start-Sleep -Milliseconds 180
  [IslandPointerTest]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [IslandPointerTest]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
