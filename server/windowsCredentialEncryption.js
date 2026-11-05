import { spawn } from "node:child_process";

// Windows DPAPI binds ciphertext to the current Windows account. Secrets travel
// through pipes, never command arguments, environment variables or log output.
export function windowsCredentialEncryption() {
  const transform = (input, decrypt) => new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("Encrypted ChatGPT credential storage is currently supported on Windows only."));
      return;
    }
    const script = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -AssemblyName System.Security",
      "$inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())",
      `$outputBytes=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
      "[Console]::Out.Write([Convert]::ToBase64String($outputBytes))",
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Credential encryption timed out.")); }, 15_000);
    child.stdout.on("data", (part) => { output += part; });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Cannot start Windows credential protection.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !output.trim()) reject(new Error("Cannot decrypt Windows credentials. Use the same Windows user."));
      else resolve(Buffer.from(output.trim(), "base64"));
    });
    child.stdin.end(Buffer.from(input).toString("base64"));
  });
  return {
    encrypt: (text) => transform(Buffer.from(text, "utf8"), false),
    decrypt: async (bytes) => (await transform(bytes, true)).toString("utf8"),
  };
}
