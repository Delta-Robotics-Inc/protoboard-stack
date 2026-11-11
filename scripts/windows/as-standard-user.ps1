# Runs a command as a standard Windows user's process runs in one respect: it
# cannot make symbolic links. What the Windows workflow uses to check a
# project the way most people's machines run it (.github/workflows/ci.yml,
# docs/ci.md § Windows): a CI runner is elevated, so a step that needs a
# privilege a standard user does not hold passes there and fails for them.
#
#   pwsh scripts/windows/as-standard-user.ps1 [-DeveloperModeOff] <command> [argument ...]
#
# Windows lets a process make a symbolic link when its token holds
# SeCreateSymbolicLinkPrivilege (an elevated process) or when Developer Mode
# is on. This script removes the privilege from its own token, which the
# command inherits, and with -DeveloperModeOff turns Developer Mode off for
# the time the command runs (a machine-wide setting, put back afterwards: for
# a CI runner, and it needs an elevated shell).
#
# It first proves the condition: Node.js must be refused a symbolic link.
# When it is not (Developer Mode is on and -DeveloperModeOff was not given),
# the script exits 2 and runs nothing, so the check never passes for the
# wrong reason. Otherwise its exit code is the command's.
param(
  [switch]$DeveloperModeOff,
  [Parameter(Mandatory = $true, Position = 0)][string]$Command,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)
$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProtoboardToken {
  [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct TOKEN_PRIVILEGES { public uint Count; public LUID Luid; public uint Attributes; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, uint length, IntPtr previous, IntPtr returned);
  /** Removes a privilege from this process's token for good; 0, or 1300 when the token never held it. */
  public static int Remove(string privilege) {
    IntPtr token; LUID luid;
    if (!OpenProcessToken(GetCurrentProcess(), 0x28 /* TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY */, out token)) return Marshal.GetLastWin32Error();
    if (!LookupPrivilegeValue(null, privilege, out luid)) return Marshal.GetLastWin32Error();
    TOKEN_PRIVILEGES state = new TOKEN_PRIVILEGES { Count = 1, Luid = luid, Attributes = 0x4 /* SE_PRIVILEGE_REMOVED */ };
    AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero);
    return Marshal.GetLastWin32Error();
  }
}
"@

$removed = [ProtoboardToken]::Remove("SeCreateSymbolicLinkPrivilege")
if ($removed -ne 0 -and $removed -ne 1300) {
  Write-Host "as-standard-user: the privilege to make symbolic links could not be removed from this process (Windows error $removed)"
  exit 2
}

$key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock"
$name = "AllowDevelopmentWithoutDevLicense"
$before = $null
if ($DeveloperModeOff) {
  $before = (Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue).$name
  if ($before) { Set-ItemProperty -Path $key -Name $name -Value 0 -Type DWord }
}
try {
  $probe = Join-Path ([System.IO.Path]::GetTempPath()) ("pb-standard-user-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path (Join-Path $probe "target") | Out-Null
  $env:PB_PROBE = $probe
  node -e "const fs = require('node:fs'), path = require('node:path'); const d = process.env.PB_PROBE; try { fs.symlinkSync(path.join(d, 'target'), path.join(d, 'link'), 'dir'); fs.unlinkSync(path.join(d, 'link')); process.exit(0); } catch (e) { console.log('as-standard-user: a symbolic link is refused here (' + e.code + '), as for a standard user'); process.exit(e.code === 'EPERM' ? 7 : 8); }"
  $probed = $LASTEXITCODE
  Remove-Item -Path $env:PB_PROBE -Recurse -Force
  Remove-Item Env:PB_PROBE
  if ($probed -ne 7) {
    Write-Host "as-standard-user: Node.js can still make a symbolic link here (probe exit $probed): Developer Mode is on, or the link failed for another reason. Nothing was run. On a CI runner, pass -DeveloperModeOff."
    exit 2
  }
  & $Command @Arguments
  $code = $LASTEXITCODE
} finally {
  if ($before) { Set-ItemProperty -Path $key -Name $name -Value $before -Type DWord }
}
exit $code
