import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn } from "node:child_process";

export const DESKTOP_APP_ID = "OpenHistoria.Native";
export const DESKTOP_PERMISSION_KEY = "oh_native_desktop_notifications";

export const TOASTER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$appId = $env:OH_TOAST_APP_ID
$gamePid = 0
[void][int]::TryParse([string]$env:OH_TOAST_PARENT, [ref]$gamePid)
$icon = [string]$env:OH_TOAST_ICON
$dry = $env:OH_TOAST_DRY -eq '1'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
Add-Type -Namespace OhToast -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int processId);
'@
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.InteropServices.WindowsRuntime;
namespace OhToast {
  public static class Clicks {
    public static readonly ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
    public sealed class Sink {
      private readonly string id;
      public Sink(string id) { this.id = id; }
      public void On(object sender, object args) { Queue.Enqueue(id); }
    }
    public static void Watch(object toast, string id) {
      Type type = toast.GetType();
      MethodInfo add = type.GetMethod("add_Activated");
      MethodInfo remove = type.GetMethod("remove_Activated");
      Type handlerType = add.GetParameters()[0].ParameterType;
      Delegate handler = Delegate.CreateDelegate(handlerType, new Sink(id), typeof(Sink).GetMethod("On"));
      Delegate adder = Delegate.CreateDelegate(typeof(Func<,>).MakeGenericType(handlerType, typeof(EventRegistrationToken)), toast, add);
      Delegate remover = Delegate.CreateDelegate(typeof(Action<EventRegistrationToken>), toast, remove);
      typeof(WindowsRuntimeMarshal).GetMethod("AddEventHandler").MakeGenericMethod(handlerType).Invoke(null, new object[] { adder, remover, handler });
    }
  }
}
'@
function Say($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}
$registered = $false
function Register-App {
  if ($dry) { return }
  $key = "HKCU:\Software\Classes\AppUserModelId\$appId"
  if (-not (Test-Path $key)) { $null = New-Item -Path $key -Force }
  Set-ItemProperty -Path $key -Name DisplayName -Value 'Open Historia'
  if ($icon -and (Test-Path -LiteralPath $icon)) { Set-ItemProperty -Path $key -Name IconUri -Value $icon }
  $script:registered = $true
}
function Read-Setting {
  try { return [string][Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).get_Setting() } catch { return 'Unknown' }
}
function Bring-Forward {
  if ($gamePid -le 0) { return }
  try {
    [void][OhToast.Win]::AllowSetForegroundWindow($gamePid)
    $handle = (Get-Process -Id $gamePid -ErrorAction Stop).MainWindowHandle
    if ($handle -ne [IntPtr]::Zero) {
      if ([OhToast.Win]::IsIconic($handle)) { [void][OhToast.Win]::ShowWindow($handle, 9) }
      [void][OhToast.Win]::SetForegroundWindow($handle)
    }
  } catch {}
}
$kept = New-Object System.Collections.Generic.List[string]
$toasts = @{}
$meta = @{}
$clicked = $null
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$pending = $reader.ReadLineAsync()
Say @{ ready = $true; dry = $dry }
while ($true) {
  if ($pending.Wait(150)) {
    $line = $pending.Result
    if ($null -eq $line) { break }
    $pending = $reader.ReadLineAsync()
    $message = $null
    try {
      $message = $line | ConvertFrom-Json
      if ($message.op -eq 'register') {
        Register-App
        Say @{ seq = $message.seq; setting = (Read-Setting) }
      } elseif ($message.op -eq 'setting') {
        Say @{ seq = $message.seq; setting = (Read-Setting) }
      } elseif ($message.op -eq 'show') {
        if (-not $registered) { Register-App }
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml([string]$message.xml)
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
        $toast.Tag = [string]$message.tag
        $toast.Group = 'diplomacy'
        $id = [string]$message.notice
        [OhToast.Clicks]::Watch($toast, $id)
        if (-not $dry) { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast) }
        $toasts[$id] = $toast
        $meta[$id] = @{ notice = $message.notice; chatId = [string]$message.chatId; gameId = [string]$message.gameId }
        $kept.Add($id)
        while ($kept.Count -gt 20) {
          $old = $kept[0]
          $kept.RemoveAt(0)
          $toasts.Remove($old)
          $meta.Remove($old)
        }
        Say @{ seq = $message.seq; shown = (-not $dry); setting = (Read-Setting) }
      } else {
        Say @{ seq = $message.seq; error = "Unknown request" }
      }
    } catch {
      Say @{ seq = $(if ($message) { $message.seq } else { 0 }); error = $_.Exception.Message }
    }
  }
  while ([OhToast.Clicks]::Queue.TryDequeue([ref]$clicked)) {
    $data = $meta[[string]$clicked]
    if ($null -eq $data) { continue }
    Bring-Forward
    Say @{ event = 'activated'; notice = $data.notice; chatId = $data.chatId; gameId = $data.gameId }
  }
  if ($dry -and $env:OH_TOAST_DRY_CLICK -eq '1' -and $meta.Count -gt 0) {
    foreach ($id in @($meta.Keys)) { [OhToast.Clicks]::Queue.Enqueue($id) }
    $env:OH_TOAST_DRY_CLICK = '0'
  }
}
if (-not $dry) {
  try { [Windows.UI.Notifications.ToastNotificationManager]::History.Clear($appId) } catch {}
}
`;

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" };
const xmlText = (value) => String(value ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
  .replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);

export const toastXml = ({ title, body, launch = "" }) => `<toast launch="${xmlText(launch)}"><visual><binding template="ToastGeneric"><text>${xmlText(title)}</text><text>${xmlText(body)}</text></binding></visual></toast>`;

export const toastTag = (chatId) => `oh-${crypto.createHash("sha1").update(`oh-diplomacy-${chatId}`).digest("hex").slice(0, 24)}`;

export const OSASCRIPT = "/usr/bin/osascript";

export const MAC_NOTIFIER_APP = "Open Historia Notifier.app";
export const MAC_NOTIFIER_EXE = "Open Historia Notifier";
export const MAC_NOTIFIER_ID = "io.github.arkniem.openhistoria.native.notifier";
export const MAC_REGISTER_MS = 120_000;

export const macNotifierBundle = (repo) => path.resolve(repo, "..", "..", "Helpers", MAC_NOTIFIER_APP);
export const macNotifierPath = (repo) => path.join(macNotifierBundle(repo), "Contents", "MacOS", MAC_NOTIFIER_EXE);
export const macNotifierSwiftArgs = (source, target, arch) => ["swiftc", "-O", "-target", arch === "arm64" ? "arm64-apple-macos11.0" : "x86_64-apple-macos10.15", source, "-o", target];

const macText = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[\r\n]+/g, " ").trim();

export const macNotificationArgs = (title, body) => ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", macText(title), macText(body)];

export const NOTIFY_SEND = "notify-send";

export const notifySendArgs = (title, body, icon = "") => ["--app-name=Open Historia", ...(icon ? [`--icon=${icon}`] : []), "--", macText(title), macText(body)];

export const findOnPath = (name, env = process.env) => {
  for (const dir of String(env.PATH ?? "").split(":")) {
    if (!dir.startsWith("/")) continue;
    const file = path.posix.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return "";
};

export const powershellPath = () => path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

export const toasterArgs = () => ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Mta", "-EncodedCommand", Buffer.from(TOASTER_SCRIPT, "utf16le").toString("base64")];

export const register = (ctx) => {
  const { storage, emit, clean, repo, standIn, engine } = ctx;
  const onMac = process.platform === "darwin";
  const macHelper = onMac ? macNotifierPath(repo) : "";
  const macOsascript = onMac && fs.existsSync(OSASCRIPT);
  let macHelperBroken = false;
  const macHelperReady = () => onMac && !macHelperBroken && fs.existsSync(macHelper);
  const macSupported = macOsascript || macHelperReady();
  const onLinux = process.platform === "linux";
  const notifySend = onLinux ? findOnPath(NOTIFY_SEND) : "";
  const supported = (process.platform === "win32" && fs.existsSync(powershellPath())) || macSupported || Boolean(notifySend);
  const icon = path.join(repo, "public", "icon-192.png");
  let broken = false;
  let toaster = null;

  const permission = () => {
    if (!supported || broken) return "unsupported";
    const stored = clean(storage.getItem(DESKTOP_PERMISSION_KEY));
    return stored === "granted" || stored === "denied" ? stored : "default";
  };

  const remember = (value) => {
    storage.setItem(DESKTOP_PERMISSION_KEY, value);
    storage.flush();
  };

  const activeGameId = () => clean(engine.getLibraryState?.()?.activeGameId);

  const startToaster = () => {
    if (toaster) return toaster;
    const child = onMac ? spawn(macHelper, ["--serve"], { stdio: ["pipe", "pipe", "pipe"], env: process.env }) : spawn(powershellPath(), toasterArgs(), {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, OH_TOAST_APP_ID: DESKTOP_APP_ID, OH_TOAST_PARENT: String(process.ppid), OH_TOAST_ICON: fs.existsSync(icon) ? icon : "" },
    });
    const state = { child, seq: 0, waiting: new Map() };
    toaster = state;
    const settleAll = () => {
      for (const resolve of state.waiting.values()) resolve(null);
      state.waiting.clear();
      if (toaster === state) toaster = null;
    };
    child.on("error", (error) => {
      if (onMac) macHelperBroken = true;
      else if (error?.code === "ENOENT") broken = true;
      process.stderr.write(`[desktop notifications] ${error?.message ?? error}\n`);
      settleAll();
    });
    child.on("exit", (code, signal) => {
      if (onMac && (code !== 0 || signal)) macHelperBroken = true;
      settleAll();
    });
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk) => process.stderr.write(`[desktop notifications] ${chunk}`));
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let message = null;
      try {
        message = JSON.parse(line.replace(/^\uFEFF/, ""));
      } catch {
        return;
      }
      if (message?.event === "activated") {
        const gameId = clean(message.gameId);
        emit("notify.activated", { notice: Number(message.notice) || 0, chatId: clean(message.chatId), sameGame: !gameId || gameId === activeGameId() });
        return;
      }
      const seq = Number(message?.seq) || 0;
      if (seq && state.waiting.has(seq)) {
        state.waiting.get(seq)(message);
        state.waiting.delete(seq);
      }
    });
    return state;
  };

  const askMac = (request, timeoutMs) => new Promise((resolve) => {
    if (request.op !== "show") {
      resolve({ setting: "Enabled" });
      return;
    }
    execFile(OSASCRIPT, macNotificationArgs(request.title, request.body), { timeout: timeoutMs }, (error) => resolve(error ? { error: clean(error.message) } : { shown: true, setting: "Enabled" }));
  });

  const askLinux = (request, timeoutMs) => new Promise((resolve) => {
    if (request.op !== "show") {
      resolve({ setting: "Enabled" });
      return;
    }
    execFile(notifySend, notifySendArgs(request.title, request.body, fs.existsSync(icon) ? icon : ""), { timeout: timeoutMs }, (error) => resolve(error ? { error: clean(error.message) } : { shown: true, setting: "Enabled" }));
  });

  const ask = async (request, timeoutMs = 20_000) => {
    if (onLinux) return askLinux(request, timeoutMs);
    if (!onMac) return askToaster(request, timeoutMs);
    if (macHelperReady()) {
      const reply = await askToaster(request, request.op === "show" ? timeoutMs : MAC_REGISTER_MS);
      if (reply?.unavailable) macHelperBroken = true;
      if (!macHelperBroken || !macOsascript) return reply;
    }
    return askMac(request, timeoutMs);
  };

  const askToaster = (request, timeoutMs) => {
    const state = startToaster();
    state.seq += 1;
    const seq = state.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.waiting.delete(seq);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      state.waiting.set(seq, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      try {
        state.child.stdin.write(`${JSON.stringify({ ...request, seq })}\n`);
      } catch {
        clearTimeout(timer);
        state.waiting.delete(seq);
        resolve(null);
      }
    });
  };

  globalThis.document?.addEventListener?.("visibilitychange", () => {
    if (globalThis.document?.hidden && !standIn && permission() === "granted" && !onLinux && (!onMac || macHelperReady())) startToaster();
  });

  const fromSetting = (setting, fallback) => {
    const value = clean(setting);
    if (!value || value === "Unknown") return fallback;
    return value === "Enabled" ? "granted" : "denied";
  };

  return {
    "notify.desktop.get": async () => ({ permission: permission() }),
    "notify.desktop.request": async () => {
      const current = permission();
      if (current === "unsupported") return { permission: current };
      if (standIn) {
        if (current === "default") remember("granted");
        return { permission: permission() };
      }
      const reply = await ask({ op: current === "default" ? "register" : "setting" });
      if (!reply || reply.error) return { permission: broken ? "unsupported" : current };
      const next = fromSetting(reply.setting, current === "default" ? "granted" : current);
      if (next !== current) remember(next);
      return { permission: permission() };
    },
    "notify.desktop": async ({ sender = "", preview = "", chatId = "", notice = 0 } = {}) => {
      if (permission() !== "granted") return { shown: false, reason: "permission", permission: permission() };
      if (!globalThis.document?.hidden) return { shown: false, reason: "visible", permission: permission() };
      if (standIn) return { shown: false, reason: "silent", wouldShow: true, permission: permission() };
      const reply = await ask({
        op: "show",
        title: `Open Historia — ${clean(sender)}`,
        body: clean(preview),
        xml: toastXml({ title: `Open Historia — ${clean(sender)}`, body: clean(preview), launch: `oh-diplomacy:${clean(chatId)}` }),
        tag: toastTag(clean(chatId)),
        notice: Number(notice) || 0,
        chatId: clean(chatId),
        gameId: activeGameId(),
      });
      if (!reply || reply.error) return { shown: false, reason: "failed", error: clean(reply?.error), permission: permission() };
      const next = fromSetting(reply.setting, "granted");
      if (next !== "granted") remember(next);
      return { shown: reply.shown === true && next === "granted", permission: permission() };
    },
  };
};
