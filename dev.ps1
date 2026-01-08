# dev.ps1 (project root)
# Usage examples:
#   .\dev.ps1
#   .\dev.ps1 -AdbWifi        # USB'siz bağlanmayı dener (daha önce bağlandıysan)
#   .\dev.ps1 -AdbWifi -AdbIp 192.168.1.101
#   .\dev.ps1 -AdbWifi -SkipExpo
#   .\dev.ps1 -SkipNode -SkipOpt

param(
  [switch]$AdbWifi,
  [string]$AdbIp = "",
  [int]$AdbPort = 5555,

  [switch]$SkipNode,
  [switch]$SkipOpt,
  [switch]$SkipExpo,

  [int]$ApiTimeoutMs = 20000
)

#Requires -Version 5.1
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-PrimaryIPv4 {
  $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Sort-Object -Property RouteMetric, InterfaceMetric |
    Select-Object -First 1

  if ($route -and $route.InterfaceIndex) {
    $ip = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notmatch "^169\.254\." } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) { return $ip }
  }

  $raw = ipconfig
  $matches = ($raw | Select-String -Pattern "IPv4 Address" -AllMatches).Line
  foreach ($line in $matches) {
    $m = [regex]::Match($line, "(\d{1,3}\.){3}\d{1,3}")
    if ($m.Success) {
      $cand = $m.Value
      if ($cand -ne "127.0.0.1" -and $cand -notmatch "^169\.254\.") { return $cand }
    }
  }
  return $null
}

function Upsert-EnvLine([string]$text, [string]$key, [string]$value) {
  $pattern = "(?m)^\s*$key\s*=.*$"
  if ($text -match $pattern) {
    return [regex]::Replace($text, $pattern, "$key=$value")
  } else {
    if (-not $text.EndsWith("`n")) { $text += "`r`n" }
    return $text + "$key=$value`r`n"
  }
}

function Try-AdbWifiConnect {
  param([string]$Ip, [int]$Port)

  Write-Host "[ADB] restarting server..."
  & adb kill-server | Out-Null
  & adb start-server | Out-Null

  $lines = (& adb devices) -split "`r?`n" | Where-Object { $_ -and ($_ -notmatch "List of devices") }

  # 1) Eğer zaten ip:port bağlıysa onu bul
  $connected = @()
  foreach ($l in $lines) {
    if ($l -match "^\s*(\d{1,3}(\.\d{1,3}){3}:\d+)\s+device\s*$") {
      $connected += $Matches[1]
    }
  }
  if ($connected.Count -gt 0) {
    Write-Host "[ADB] already connected:" $connected[0]
    return $true
  }

  # 2) IP verildiyse direkt connect dene
  if ($Ip -and $Ip.Trim().Length -gt 0) {
    Write-Host "[ADB] connect -> $Ip`:$Port"
    & adb connect "$Ip`:$Port"
    return $true
  }

  # 3) .adbip dosyası varsa ordan oku
  $adbIpFile = Join-Path $PSScriptRoot ".adbip"
  if (Test-Path $adbIpFile) {
    $saved = (Get-Content $adbIpFile -Raw).Trim()
    if ($saved) {
      Write-Host "[ADB] connect (from .adbip) -> $saved`:$Port"
      & adb connect "$saved`:$Port"
      return $true
    }
  }

  # 4) mDNS tls entry varsa (adb-..._adb-tls-connect...) bunu otomatik kullanamıyoruz (pair gerekir)
  # burada kullanıcıya net mesaj veriyoruz
  Write-Host "[ADB] No saved IP and no ip:port connected."
  Write-Host "[ADB] First-time setup requires USB once: run .\adb-wifi.ps1"
  return $false
}

# --- 0) IP ---
$ip = Get-PrimaryIPv4
if (-not $ip) { throw "LAN IPv4 bulunamadı. 'ipconfig' çıktısında IPv4 Address var mı?" }
Write-Host "[DEV] PC IP = $ip"

# --- 1) Patch client .env ---
$clientEnvPath = Join-Path $PSScriptRoot ".env"
$content = ""
if (Test-Path $clientEnvPath) { $content = Get-Content $clientEnvPath -Raw }

$content = Upsert-EnvLine $content "EXPO_PUBLIC_API_BASE" "http://$ip:5000"
$content = Upsert-EnvLine $content "EXPO_PUBLIC_OPTIMIZER_BASE" "http://$ip:8001"
$content = Upsert-EnvLine $content "EXPO_PUBLIC_API_TIMEOUT_MS" "$ApiTimeoutMs"

Set-Content -Path $clientEnvPath -Value $content -Encoding utf8
Write-Host "[DEV] Patched .env: API_BASE=http://$ip:5000 OPTIMIZER_BASE=http://$ip:8001 TIMEOUT=$ApiTimeoutMs"

# --- 2) Optional: ADB Wi-Fi connect (USB'siz) ---
if ($AdbWifi) {
  $ok = Try-AdbWifiConnect -Ip $AdbIp -Port $AdbPort
  if ($ok -and (-not $AdbIp)) {
    # Eğer kullanıcı ip girmediyse, dev env ile aynı subnette en olası IP telefonu olabilir ama garanti değil.
    # Bu yüzden sadece .adbip varsa/bağlandıysa saklarız.
    # (adb devices'tan ip:port çıkarsa sakla)
    $lines2 = (& adb devices) -split "`r?`n"
    $firstIpPort = $lines2 | Where-Object { $_ -match "^\s*(\d{1,3}(\.\d{1,3}){3}):$AdbPort\s+device\s*$" } | Select-Object -First 1
    if ($firstIpPort) {
      $m = [regex]::Match($firstIpPort, "(\d{1,3}(\.\d{1,3}){3})")
      if ($m.Success) {
        $adbIpFile2 = Join-Path $PSScriptRoot ".adbip"
        Set-Content -Path $adbIpFile2 -Value $m.Value -Encoding utf8
        Write-Host "[ADB] Saved phone IP to .adbip =" $m.Value
      }
    }
  }
}

# --- 3) Start Node server (5000) ---
if (-not $SkipNode) {
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$PSScriptRoot\server`"; node index.js"
  Write-Host "[DEV] Node server launching..."
} else {
  Write-Host "[DEV] SkipNode enabled."
}

# --- 4) Start OR-tool (8001) ---
if (-not $SkipOpt) {
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$PSScriptRoot\OR-tool`"; if (Test-Path .\.venv\Scripts\Activate.ps1) { .\.venv\Scripts\Activate.ps1 }; uvicorn main:app --host 0.0.0.0 --port 8001"
  Write-Host "[DEV] OR-tool launching..."
} else {
  Write-Host "[DEV] SkipOpt enabled."
}

# --- 5) Start Expo dev client ---
if (-not $SkipExpo) {
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$PSScriptRoot`"; npx expo start --dev-client"
  Write-Host "[DEV] Expo launching..."
} else {
  Write-Host "[DEV] SkipExpo enabled."
}

Write-Host "[DEV] DONE."
Write-Host "Tip: daily run -> .\dev.ps1 -AdbWifi"
