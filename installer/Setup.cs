using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Open Historia Native Setup")]
[assembly: AssemblyProduct("Open Historia Native")]

namespace OpenHistoriaSetup
{
	public sealed class Bar : Panel
	{
		public float Fraction;

		public Bar()
		{
			DoubleBuffered = true;
		}

		protected override void OnPaint(PaintEventArgs e)
		{
			base.OnPaint(e);
			using (var track = new SolidBrush(Color.FromArgb(38, 38, 42)))
			using (var fill = new SolidBrush(Color.FromArgb(43, 193, 243)))
			{
				e.Graphics.FillRectangle(track, 0, 0, Width, Height);
				e.Graphics.FillRectangle(fill, 0, 0, (int)(Width * Math.Max(0f, Math.Min(1f, Fraction))), Height);
			}
		}
	}

	public sealed class SetupForm : Form
	{
		const string AppName = "Open Historia Native";
		public static string TargetOverride = "";
		public static bool Unattended;
		readonly Label status;
		readonly Bar bar;
		readonly string target;

		public SetupForm()
		{
			target = TargetOverride.Length > 0 ? TargetOverride : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
			Text = AppName + " Setup";
			ClientSize = new Size(460, 168);
			FormBorderStyle = FormBorderStyle.FixedDialog;
			MaximizeBox = false;
			MinimizeBox = false;
			StartPosition = FormStartPosition.CenterScreen;
			BackColor = Color.FromArgb(19, 19, 21);
			ForeColor = Color.FromArgb(246, 246, 247);
			Font = new Font("Segoe UI", 9.5f);
			try
			{
				Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
			}
			catch (Exception)
			{
			}
			var title = new Label();
			title.Text = AppName;
			title.Font = new Font("Segoe UI Semibold", 15f);
			title.AutoSize = true;
			title.Location = new Point(24, 22);
			Controls.Add(title);
			status = new Label();
			status.Text = "Getting ready…";
			status.ForeColor = Color.FromArgb(178, 178, 182);
			status.AutoSize = false;
			status.Size = new Size(412, 40);
			status.Location = new Point(24, 64);
			Controls.Add(status);
			bar = new Bar();
			bar.Size = new Size(412, 6);
			bar.Location = new Point(24, 118);
			Controls.Add(bar);
			Shown += delegate { new Thread(Run) { IsBackground = true }.Start(); };
		}

		void Say(string text, float fraction)
		{
			if (IsDisposed) return;
			BeginInvoke((MethodInvoker)delegate
			{
				status.Text = text;
				if (fraction >= 0f)
				{
					bar.Fraction = fraction;
					bar.Invalidate();
				}
			});
		}

		void Fail(string message)
		{
			Invoke((MethodInvoker)delegate
			{
				MessageBox.Show(this, AppName + " could not be installed.\n\n" + message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
				Close();
			});
		}

		static void StopRunning(string folder)
		{
			foreach (var name in new[] { "Open Historia", "godot", "node" })
			{
				foreach (var process in Process.GetProcessesByName(name))
				{
					try
					{
						var path = process.MainModule.FileName;
						if (path.StartsWith(folder, StringComparison.OrdinalIgnoreCase))
						{
							process.Kill();
							process.WaitForExit(5000);
						}
					}
					catch (Exception)
					{
					}
				}
			}
		}

		void Run()
		{
			try
			{
				if (Directory.Exists(target))
				{
					if (!File.Exists(Path.Combine(target, ".oh-native-install")))
					{
						Fail("The folder " + target + " already exists and was not made by this installer, so it was left alone.");
						return;
					}
					Say("Closing the running game…", 0f);
					StopRunning(target);
					Say("Removing the previous version…", 0f);
					Directory.Delete(target, true);
				}
				Directory.CreateDirectory(target);
				using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
				using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
				{
					var total = zip.Entries.Count;
					var done = 0;
					var root = Path.GetFullPath(target) + Path.DirectorySeparatorChar;
					foreach (var entry in zip.Entries)
					{
						done++;
						var relative = entry.FullName.Replace('\\', '/');
						while (relative.StartsWith("./")) relative = relative.Substring(2);
						if (relative.Length == 0) continue;
						var destination = Path.GetFullPath(Path.Combine(target, relative.Replace('/', Path.DirectorySeparatorChar)));
						if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
						if (relative.EndsWith("/"))
						{
							Directory.CreateDirectory(destination);
							continue;
						}
						Directory.CreateDirectory(Path.GetDirectoryName(destination));
						using (var input = entry.Open())
						using (var output = File.Create(destination))
						{
							input.CopyTo(output);
						}
						if (done % 40 == 0 || done == total) Say("Installing… " + done + " of " + total + " files", done / (float)total);
					}
				}
				if (Unattended)
				{
					Invoke((MethodInvoker)Close);
					return;
				}
				Say("Adding shortcuts…", 1f);
				var godot = Path.Combine(target, "runtime", "Open Historia.exe");
				var project = Path.Combine(target, "native", "godot");
				var icon = Path.Combine(target, "runtime", "open-historia.ico");
				var shellType = Type.GetTypeFromProgID("WScript.Shell");
				var shell = Activator.CreateInstance(shellType);
				foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Programs), Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) })
				{
					var link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(folder, AppName + ".lnk") });
					var linkType = link.GetType();
					linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { godot });
					linkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { "--path \"" + project + "\"" });
					linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { target });
					linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { icon });
					linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { AppName });
					linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
				}
				var uninstall = Path.Combine(target, "uninstall.ps1");
				File.WriteAllText(uninstall, string.Join("\r\n", new[]
				{
					"$ErrorActionPreference = \"SilentlyContinue\"",
					"Get-Process -Name \"Open Historia\" | Where-Object { $_.Path -like \"" + target + "*\" } | Stop-Process -Force",
					"Get-Process -Name node | Where-Object { $_.Path -like \"" + target + "*\" } | Stop-Process -Force",
					"Remove-Item (Join-Path ([Environment]::GetFolderPath(\"Programs\")) \"" + AppName + ".lnk\")",
					"Remove-Item (Join-Path ([Environment]::GetFolderPath(\"Desktop\")) \"" + AppName + ".lnk\")",
					"Remove-Item -Recurse -Force \"HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\OpenHistoriaNative\"",
					"Start-Process cmd.exe -ArgumentList \"/c timeout /t 2 >nul & rmdir /s /q `\"" + target + "`\"\" -WindowStyle Hidden",
					"",
				}));
				using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenHistoriaNative"))
				{
					key.SetValue("DisplayName", AppName);
					key.SetValue("DisplayIcon", icon);
					key.SetValue("Publisher", "Open Historia");
					key.SetValue("InstallLocation", target);
					key.SetValue("UninstallString", "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + uninstall + "\"");
					key.SetValue("NoModify", 1, RegistryValueKind.DWord);
					key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
				}
				Say("Starting " + AppName + "…", 1f);
				var start = new ProcessStartInfo(godot, "--path \"" + project + "\"");
				start.WorkingDirectory = target;
				start.UseShellExecute = false;
				Process.Start(start);
				Thread.Sleep(900);
				Invoke((MethodInvoker)Close);
			}
			catch (Exception error)
			{
				Fail(error.Message);
			}
		}

		[STAThread]
		static void Main(string[] args)
		{
			for (var index = 0; index < args.Length; index++)
			{
				if (args[index] == "--to" && index + 1 < args.Length)
				{
					TargetOverride = args[index + 1];
					Unattended = true;
				}
			}
			Application.EnableVisualStyles();
			Application.SetCompatibleTextRenderingDefault(false);
			Application.Run(new SetupForm());
		}
	}
}
