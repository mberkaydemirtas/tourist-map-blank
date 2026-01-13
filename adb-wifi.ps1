# adb-wifi.ps1 — One-command Wireless ADB setup (USB once) + daily safe mode
# Usage:
#   .\adb-wifi.ps1
#   .\adb-wifi.ps1 -Port 5555
#   .\adb-wifi.ps1 -ForceRestart   # (optional) always kill/start server

param(
  [int]$Port = 5555,
  [switch]$ForceRestart
)

#Requires -Version 5.1
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-AdbDevices {
  $raw = & adb devices
  $lines = ($raw -split "`r?`n") | Where-Object { $_ -and ($_ -notmatch "List of devices") }

  $out = @()
  foreach ($l in $lines) {
    # e.g. "R5CXA15SJBT device" or "192.168.1.107:5555 device" or "R5... unauthorized"
    if ($l -match "^\s*(\S+)\s+(\S+)\s*$") {
      $out += [pscustomobject]@{
        Serial = $Matches[1]
        State  = $Matches[2]
        Line   = $l
      }
    }
  }
  return $out
}

function Is-IpPort([string]$s) {
  return ($s -match "^\d{1,3}(\.\d{1,3}){3}:\d+$")
}

function Is-MdnsTls([string]$s) {
  return ($s -match "^adb-.*_adb-tls-connect\._tcp$")
}

# --------------------------
# 0) If already connected over Wi-Fi, do nothing (daily safe mode)
# --------------------------
if (-not $ForceRestart) {
  try {
    $devs0 = Get-AdbDevices
    $wifiOk = $devs0 | Where-Object { Is-IpPort $_.Serial -and $_.State -eq "device" } | Select-Object -First 1
    if ($wifiOk) {
      Write-Host "[ADB] ✅ Wi-Fi device already connected:" $wifiOk.Serial
      # still refresh .adbip for dev.ps1 convenience
      $ipOnly = ($wifiOk.Serial -split ":")[0]
      $adbIpFile0 = Join-Path $PSScriptRoot ".adbip"
      Set-Content -Path $adbIpFile0 -Value $ipOnly -Encoding utf8
      Write-Host "[ADB] Saved phone IP to .adbip =" $ipOnly
      Write-Host "[ADB] devices:"
      & adb devices
      exit 0
    }
  } catch {
    # ignore and continue
  }
}

# --------------------------
# 1) Restart ADB server (optional / forced)
# --------------------------
Write-Host "[ADB] restarting server..."
& adb kill-server | Out-Null
& adb start-server | Out-Null

# --------------------------
# 2) Collect devices
# --------------------------
$devs = Get-AdbDevices

# If there is a Wi-Fi device but not in "device" state, show hint
$wifiAny = $devs | Where-Object { Is-IpPort $_.Serial } | Select-Object -First 1
if ($wifiAny -and $wifiAny.State -ne "device") {
  Write-Host "[ADB] ⚠ Wi-Fi device exists but not ready:" $wifiAny.Line
  Write-Host "[ADB] Tip: phone may need 'Allow wireless debugging' / pairing again."
}

# --------------------------
# 3) Pick a USB device for initial setup
#    Exclude:
#      - ip:port entries (Wi-Fi)
#      - mDNS tls entries
# --------------------------
$usbCandidates = $devs | Where-Object {
  -not (Is-IpPort $_.Serial) -and
  -not (Is-MdnsTls $_.Serial)
}

# Prefer a USB that is in "device" state
$usbOk = $usbCandidates | Where-Object { $_.State -eq "device" } | Select-Object -First 1

if (-not $usbOk) {
  # if none in device state, check for unauthorized
  $unauth = $usbCandidates | Where-Object { $_.State -eq "unauthorized" } | Select-Object -First 1
  if ($unauth) {
    throw "[ADB] Telefon USB ile görünüyor ama 'unauthorized'. Telefonda 'Allow USB debugging' popup'ını onayla, sonra tekrar çalıştır."
  }

  # no USB at all
  throw "[ADB] Telefon görünmüyor. İlk kurulum için USB ile bir kere bağla ve 'Allow USB debugging' onayını ver."
}

$usb = $usbOk.Serial
Write-Host "[ADB] usb_target =" $usb

# --------------------------
# 4) Get phone IP BEFORE tcpip (because tcpip restarts adbd)
# --------------------------
$route = & adb -s $usb shell "ip route get 1.1.1.1" 2>$null
$ip = ([regex]::Match($route, "src\s+(\d{1,3}(\.\d{1,3}){3})")).Groups[1].Value

if (-not $ip) {
  $ip = (& adb -s $usb shell "ip -f inet addr show wlan0" 2>$null |
    Select-String -Pattern "inet\s+(\d{1,3}(\.\d{1,3}){3})" |
    ForEach-Object {
      ($_ -match "inet\s+(\d{1,3}(\.\d{1,3}){3})") | Out-Null
      $Matches[1]
    } | Select-Object -First 1)
}

if (-not $ip) { throw "[ADB] Telefon IP'si bulunamadı (wlan0 yok mu / Wi-Fi açık mı?)" }

Write-Host "[ADB] phone_ip =" $ip

# --------------------------
# 5) Enable tcpip on USB target
# --------------------------
Write-Host "[ADB] enabling tcpip $Port ..."
& adb -s $usb tcpip $Port | Out-Null

Start-Sleep -Milliseconds 900

# --------------------------
# 6) Connect over Wi-Fi
# --------------------------
Write-Host "[ADB] connecting $ip`:$Port ..."
& adb connect "$ip`:$Port" | Out-Null

# --------------------------
# 7) Save IP for dev.ps1 auto-connect
# --------------------------
$adbIpFile = Join-Path $PSScriptRoot ".adbip"
Set-Content -Path $adbIpFile -Value $ip -Encoding utf8
Write-Host "[ADB] Saved phone IP to .adbip =" $ip

Write-Host "[ADB] DONE. devices:"
& adb devices

Write-Host ""
Write-Host "[ADB] ✅ Done. Günlük kullanım:"
Write-Host "      - Wi-Fi bağlıysa: hiç gerek yok, direkt dev.ps1 çalıştır."
Write-Host "      - Koparsa: .\adb-wifi.ps1 (USB takılıyken 1 kere) veya adb connect $ip`:$Port"
