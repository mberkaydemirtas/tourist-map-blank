# adb-wifi.ps1 — One-command Wireless ADB setup (USB once)
# Usage:
#   .\adb-wifi.ps1
#   .\adb-wifi.ps1 -Port 5555

param(
  [int]$Port = 5555
)

#Requires -Version 5.1
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "[ADB] restarting server..."
adb kill-server | Out-Null
adb start-server | Out-Null

# ---- pick USB device (exclude mdns adb-tls-connect + exclude ip:port entries) ----
$lines = (adb devices) -split "`r?`n" | Where-Object { $_ -and ($_ -notmatch "List of devices") }

$devices = @()
foreach ($l in $lines) {
  if ($l -match "^\s*(\S+)\s+device\s*$") { $devices += $Matches[1] }
}

if (-not $devices.Count) {
  throw "[ADB] Telefon görünmüyor. USB ile bağla ve 'Allow USB debugging' onayını ver."
}

$usb = $devices |
  Where-Object {
    ($_ -notmatch "^\d{1,3}(\.\d{1,3}){3}:\d+$") -and
    ($_ -notmatch "^adb-.*_adb-tls-connect\._tcp$")
  } | Select-Object -First 1

if (-not $usb) { $usb = $devices[0] }

Write-Host "[ADB] usb_target =" $usb

# ---- IMPORTANT: get phone IP BEFORE tcpip (because tcpip restarts adbd) ----
$route = adb -s $usb shell "ip route get 1.1.1.1" 2>$null
$ip = ([regex]::Match($route, "src\s+(\d{1,3}(\.\d{1,3}){3})")).Groups[1].Value

if (-not $ip) {
  $ip = (adb -s $usb shell "ip -f inet addr show wlan0" 2>$null |
    Select-String -Pattern "inet\s+(\d{1,3}(\.\d{1,3}){3})" |
    ForEach-Object {
      ($_ -match "inet\s+(\d{1,3}(\.\d{1,3}){3})") | Out-Null
      $Matches[1]
    } | Select-Object -First 1)
}

if (-not $ip) { throw "[ADB] Telefon IP'si bulunamadı (wlan0 yok mu?)" }

Write-Host "[ADB] phone_ip =" $ip

# ---- enable tcpip on USB target ----
Write-Host "[ADB] enabling tcpip $Port ..."
adb -s $usb tcpip $Port | Out-Null

Start-Sleep -Milliseconds 900

Write-Host "[ADB] connecting $ip`:$Port ..."
adb connect "$ip`:$Port" | Out-Null

# Save IP for dev.ps1 auto-connect
$adbIpFile = Join-Path $PSScriptRoot ".adbip"
Set-Content -Path $adbIpFile -Value $ip -Encoding utf8
Write-Host "[ADB] Saved phone IP to .adbip =" $ip

Write-Host "[ADB] DONE. devices:"
adb devices

Write-Host ""
Write-Host "[ADB] ✅ Done. Artık USB'siz günlük kullanım: .\dev.ps1 -AdbWifi"
