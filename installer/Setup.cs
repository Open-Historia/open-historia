using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
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
		const string Marker = ".oh-native-install";
		public static string TargetOverride = "";
		public static bool Unattended;
		public static bool Updating;
		public static bool Relaunch = true;
		public static int ExitCode;
		public static string StageDir = "";
		public static string StageMode = "";
		public static List<string[]> Plan = new List<string[]>();
		const int WatchSeconds = 180;
		readonly Label status;
		readonly Bar bar;
		readonly string target;
		readonly string io;

		public SetupForm()
		{
			var chosen = TargetOverride.Length > 0 ? TargetOverride : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
			target = LongPath(Path.GetFullPath(chosen).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
			io = Extended(target);
			Text = AppName + (Updating ? " Update" : " Setup");
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
			title.Text = Updating ? "Updating " + AppName : AppName;
			title.Font = new Font("Segoe UI Semibold", 15f);
			title.AutoSize = true;
			title.Location = new Point(24, 22);
			Controls.Add(title);
			status = new Label();
			status.Text = StageMode == "rollback" ? "Putting back the version you had…" : Updating ? "Getting the update ready…" : "Getting ready…";
			status.ForeColor = Color.FromArgb(178, 178, 182);
			status.AutoSize = false;
			status.AutoEllipsis = true;
			status.Size = new Size(412, 40);
			status.Location = new Point(24, 64);
			Controls.Add(status);
			bar = new Bar();
			bar.Size = new Size(412, 6);
			bar.Location = new Point(24, 118);
			Controls.Add(bar);
			ThreadStart work = Run;
			if (StageMode == "apply") work = RunApply;
			else if (StageMode == "rollback") work = RunRollback;
			else if (Updating) work = RunUpdate;
			Shown += delegate { new Thread(work) { IsBackground = true }.Start(); };
		}

		[DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
		static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint size);

		static string LongPath(string path)
		{
			var buffer = new StringBuilder(32768);
			var length = GetLongPathName(path, buffer, (uint)buffer.Capacity);
			return length > 0 && length < buffer.Capacity ? buffer.ToString() : path;
		}

		static string Extended(string path)
		{
			if (path.StartsWith(@"\\?\")) return path;
			if (path.StartsWith(@"\\")) return @"\\?\UNC\" + path.Substring(2);
			return @"\\?\" + path;
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
			ExitCode = 1;
			Invoke((MethodInvoker)delegate
			{
				MessageBox.Show(this, AppName + " could not be installed.\n\n" + message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
				Close();
			});
		}

		static HashSet<string> ExeNames(string folder)
		{
			var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Open Historia", "godot", "node" };
			try
			{
				if (Directory.Exists(folder))
				{
					foreach (var exe in Directory.EnumerateFiles(folder, "*.exe", SearchOption.AllDirectories)) names.Add(Path.GetFileNameWithoutExtension(exe));
				}
			}
			catch (Exception)
			{
			}
			return names;
		}

		static List<Process> AppProcesses(string folder, HashSet<string> names)
		{
			var found = new List<Process>();
			var prefix = folder + Path.DirectorySeparatorChar;
			var self = Process.GetCurrentProcess().Id;
			foreach (var name in names)
			{
				foreach (var process in Process.GetProcessesByName(name))
				{
					var mine = false;
					try
					{
						mine = process.Id != self && LongPath(process.MainModule.FileName).StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
					}
					catch (Exception)
					{
					}
					if (mine) found.Add(process);
					else process.Dispose();
				}
			}
			return found;
		}

		static void StopRunning(string folder, HashSet<string> names)
		{
			foreach (var process in AppProcesses(folder, names))
			{
				try
				{
					process.Kill();
					process.WaitForExit(5000);
				}
				catch (Exception)
				{
				}
				process.Dispose();
			}
		}

		static bool WaitForClose(string folder, HashSet<string> names, int milliseconds)
		{
			var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
			while (true)
			{
				var running = AppProcesses(folder, names);
				var count = running.Count;
				foreach (var process in running) process.Dispose();
				if (count == 0) return true;
				if (DateTime.UtcNow >= deadline) return false;
				Thread.Sleep(250);
			}
		}

		static void RemoveFolder(string folder)
		{
			if (Directory.Exists(folder)) Directory.Delete(folder, true);
		}

		static void RemoveLeftovers(string folder)
		{
			var parent = Path.GetDirectoryName(folder);
			var name = Path.GetFileName(folder);
			if (string.IsNullOrEmpty(parent) || !Directory.Exists(parent)) return;
			foreach (var pattern in new[] { name + ".update-*", name + ".previous-*" })
			{
				foreach (var leftover in Directory.GetDirectories(parent, pattern))
				{
					try
					{
						RemoveFolder(leftover);
					}
					catch (Exception)
					{
					}
				}
			}
		}

		static string LaunchArguments(string folder)
		{
			var project = Path.Combine(folder, "native", "godot");
			return File.Exists(Path.Combine(project, "project.godot")) ? "--path \"" + project + "\"" : "";
		}

		static void RefreshShortcuts(string folder)
		{
			try
			{
				var godot = Path.GetFullPath(Path.Combine(folder, "runtime", "Open Historia.exe"));
				var arguments = LaunchArguments(folder);
				var shellType = Type.GetTypeFromProgID("WScript.Shell");
				var shell = Activator.CreateInstance(shellType);
				foreach (var place in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Programs), Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) })
				{
					var file = Path.Combine(place, AppName + ".lnk");
					if (!File.Exists(file)) continue;
					var link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
					var linkType = link.GetType();
					var pointsAt = (string)linkType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, link, null);
					if (string.IsNullOrEmpty(pointsAt) || !string.Equals(Path.GetFullPath(pointsAt), godot, StringComparison.OrdinalIgnoreCase)) continue;
					if ((string)linkType.InvokeMember("Arguments", BindingFlags.GetProperty, null, link, null) == arguments) continue;
					linkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { arguments });
					linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
				}
			}
			catch (Exception)
			{
			}
		}

		static Process Launch(string folder)
		{
			RefreshShortcuts(folder);
			var start = new ProcessStartInfo(Path.Combine(folder, "runtime", "Open Historia.exe"), LaunchArguments(folder));
			start.WorkingDirectory = folder;
			start.UseShellExecute = false;
			return Process.Start(start);
		}

		static List<string[]> ReadPlan(string stage)
		{
			var rows = new List<string[]>();
			foreach (var line in File.ReadAllLines(Path.Combine(stage, "apply.txt"), Encoding.UTF8))
			{
				var tab = line.IndexOf('\t');
				if (tab <= 0) continue;
				rows.Add(new[] { line.Substring(0, tab), line.Substring(tab + 1) });
			}
			return rows;
		}

		static string PlanValue(string key)
		{
			foreach (var row in Plan) if (row[0] == key) return row[1];
			return "";
		}

		static string Inside(string root, string relative)
		{
			var clean = relative.Replace('/', Path.DirectorySeparatorChar);
			if (clean.Length == 0 || Path.IsPathRooted(clean) || clean.IndexOf(':') >= 0) throw new InvalidOperationException("The update names a file outside the game's folder: " + relative);
			foreach (var part in clean.Split(Path.DirectorySeparatorChar))
			{
				if (part.Length == 0 || part == "." || part == "..") throw new InvalidOperationException("The update names a file outside the game's folder: " + relative);
			}
			return root + Path.DirectorySeparatorChar + clean;
		}

		void Persist(Action step, HashSet<string> names)
		{
			Exception last = null;
			for (var attempt = 0; attempt < 12; attempt++)
			{
				try
				{
					step();
					return;
				}
				catch (IOException error)
				{
					last = error;
				}
				catch (UnauthorizedAccessException error)
				{
					last = error;
				}
				StopRunning(target, names);
				Thread.Sleep(500);
			}
			throw last;
		}

		void MoveOver(string from, string to, HashSet<string> names)
		{
			Directory.CreateDirectory(Path.GetDirectoryName(to));
			Persist(delegate
			{
				if (File.Exists(to)) File.Delete(to);
				File.Move(from, to);
			}, names);
		}

		void Undo(string stage, HashSet<string> names)
		{
			var journal = Path.Combine(stage, "journal.txt");
			if (!File.Exists(journal)) return;
			var previous = Path.Combine(stage, "previous");
			var lines = File.ReadAllLines(journal, Encoding.UTF8);
			for (var index = lines.Length - 1; index >= 0; index--)
			{
				var tab = lines[index].IndexOf('\t');
				if (tab <= 0) continue;
				var verb = lines[index].Substring(0, tab);
				var relative = lines[index].Substring(tab + 1);
				var installed = Inside(io, relative);
				var kept = Inside(previous, relative);
				if (verb == "moved" || verb == "removed")
				{
					if (File.Exists(kept)) MoveOver(kept, installed, names);
				}
				else if (verb == "added" && File.Exists(installed))
				{
					Persist(delegate { File.Delete(installed); }, names);
				}
				Say("Putting back the version you had… " + (lines.Length - index) + " of " + lines.Length, 1f - (lines.Length - index) / (float)lines.Length);
			}
			File.Delete(journal);
		}

		static string Mark(string stage, string name)
		{
			return Path.Combine(stage, name);
		}

		void RolledBack(string stage)
		{
			File.WriteAllText(Mark(stage, "rolled-back"), PlanValue("build"));
			if (File.Exists(Mark(stage, "applied"))) File.Delete(Mark(stage, "applied"));
		}

		void Watch(string stage, Process game, HashSet<string> names)
		{
			Invoke((MethodInvoker)Hide);
			var deadline = DateTime.UtcNow.AddSeconds(WatchSeconds);
			while (DateTime.UtcNow < deadline)
			{
				if (File.Exists(Mark(stage, "confirmed")) || !File.Exists(Mark(stage, "applied"))) return;
				if (game.HasExited)
				{
					if (game.ExitCode == 0) return;
					ExitCode = 1;
					Invoke((MethodInvoker)Show);
					Say("The new version did not start, so the version you had is being put back…", 1f);
					if (!WaitForClose(target, names, 5000)) StopRunning(target, names);
					Undo(stage, names);
					RolledBack(stage);
					Say("Starting the version you had…", 0f);
					Launch(target);
					Thread.Sleep(1500);
					return;
				}
				Thread.Sleep(500);
			}
		}

		void RunApply()
		{
			var stage = Extended(LongPath(Path.GetFullPath(StageDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)));
			var names = ExeNames(io);
			try
			{
				if (!File.Exists(Path.Combine(io, Marker)))
				{
					FailUpdate("The folder " + target + " is not an installation of " + AppName + ", so it was left alone.", false);
					return;
				}
				if (!File.Exists(Mark(stage, "ready")) || File.Exists(Mark(stage, "applied")))
				{
					FailUpdate("The downloaded update is not complete, or was applied already.", true);
					return;
				}
				Say("Waiting for the game to close…", 0.05f);
				if (!WaitForClose(target, names, 15000))
				{
					Say("Closing the running game…", 0.08f);
					StopRunning(target, names);
				}
				Undo(stage, names);
				var previous = Path.Combine(stage, "previous");
				var files = Path.Combine(stage, "files");
				var total = 0;
				foreach (var row in Plan) if (row[0] == "put" || row[0] == "remove") total++;
				var done = 0;
				try
				{
					using (var journal = new StreamWriter(Path.Combine(stage, "journal.txt"), false, new UTF8Encoding(false)))
					{
						journal.AutoFlush = true;
						foreach (var row in Plan)
						{
							if (row[0] != "put" && row[0] != "remove") continue;
							var relative = row[1];
							var installed = Inside(io, relative);
							var kept = Inside(previous, relative);
							if (row[0] == "put")
							{
								var source = Inside(files, relative);
								if (!File.Exists(source)) throw new FileNotFoundException("The update is missing " + relative);
								if (File.Exists(installed))
								{
									journal.WriteLine("moved\t" + relative);
									MoveOver(installed, kept, names);
								}
								else
								{
									journal.WriteLine("added\t" + relative);
								}
								Directory.CreateDirectory(Path.GetDirectoryName(installed));
								Persist(delegate { File.Copy(source, installed, true); }, names);
							}
							else if (File.Exists(installed))
							{
								journal.WriteLine("removed\t" + relative);
								MoveOver(installed, kept, names);
							}
							done++;
							Say("Putting the new files in place… " + done + " of " + total, 0.1f + 0.85f * done / Math.Max(1, total));
						}
					}
				}
				catch (Exception error)
				{
					Undo(stage, names);
					RolledBack(stage);
					FailUpdate("The update could not be applied (" + error.Message + "), so the version you had was kept.", true);
					return;
				}
				File.WriteAllText(Mark(stage, "applied"), PlanValue("build"));
				if (Relaunch)
				{
					Say("Starting " + AppName + "…", 1f);
					Watch(stage, Launch(target), names);
				}
				else
				{
					RefreshShortcuts(target);
					Say("Updated. The game opens on the new version next time.", 1f);
					Thread.Sleep(1200);
				}
				Invoke((MethodInvoker)Close);
			}
			catch (Exception error)
			{
				FailUpdate("The update could not be applied: " + error.Message, true);
			}
		}

		void RunRollback()
		{
			var stage = Extended(LongPath(Path.GetFullPath(StageDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)));
			var names = ExeNames(io);
			try
			{
				if (!File.Exists(Path.Combine(io, Marker)))
				{
					FailUpdate("The folder " + target + " is not an installation of " + AppName + ", so it was left alone.", false);
					return;
				}
				Say("Waiting for the game to close…", 0f);
				if (!WaitForClose(target, names, 15000)) StopRunning(target, names);
				Undo(stage, names);
				RolledBack(stage);
				if (Relaunch)
				{
					Say("Starting the version you had…", 0f);
					Launch(target);
					Thread.Sleep(900);
				}
				else
				{
					Say("The version you had is back.", 0f);
					Thread.Sleep(1200);
				}
				Invoke((MethodInvoker)Close);
			}
			catch (Exception error)
			{
				FailUpdate("The previous version could not be put back: " + error.Message, false);
			}
		}

		void Extract(string destination, float from, float span, string verb)
		{
			Directory.CreateDirectory(destination);
			using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
			{
			if (stream == null) throw new InvalidOperationException("This copy of the updater carries no game files. Run Open-Historia-Native-Setup.exe instead.");
			using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
			{
				var total = zip.Entries.Count;
				var done = 0;
				var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
				foreach (var entry in zip.Entries)
				{
					done++;
					var relative = entry.FullName.Replace('\\', '/');
					while (relative.StartsWith("./")) relative = relative.Substring(2);
					if (relative.Length == 0) continue;
					var path = Path.GetFullPath(Path.Combine(destination, relative.Replace('/', Path.DirectorySeparatorChar)));
					if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
					if (relative.EndsWith("/"))
					{
						Directory.CreateDirectory(path);
						continue;
					}
					Directory.CreateDirectory(Path.GetDirectoryName(path));
					using (var input = entry.Open())
					using (var output = File.Create(path))
					{
						input.CopyTo(output);
					}
					if (done % 40 == 0 || done == total) Say(verb + " " + done + " of " + total + " files", from + span * (done / (float)total));
				}
			}
			}
		}

		static void CopyOver(string from, string to)
		{
			var kept = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
			foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
			{
				var relative = file.Substring(from.Length).TrimStart(Path.DirectorySeparatorChar);
				var destination = Path.Combine(to, relative);
				Directory.CreateDirectory(Path.GetDirectoryName(destination));
				File.Copy(file, destination, true);
				kept.Add(relative);
			}
			foreach (var file in new List<string>(Directory.EnumerateFiles(to, "*", SearchOption.AllDirectories)))
			{
				var relative = file.Substring(to.Length).TrimStart(Path.DirectorySeparatorChar);
				if (kept.Contains(relative)) continue;
				try
				{
					File.Delete(file);
				}
				catch (Exception)
				{
				}
			}
		}

		void Swap(string staging, string previous, HashSet<string> names)
		{
			Exception blocked = null;
			for (var attempt = 0; attempt < 12; attempt++)
			{
				try
				{
					Directory.Move(io, previous);
					blocked = null;
					break;
				}
				catch (IOException error)
				{
					blocked = error;
				}
				catch (UnauthorizedAccessException error)
				{
					blocked = error;
				}
				StopRunning(target, names);
				Thread.Sleep(500);
			}
			if (blocked != null)
			{
				CopyOver(staging, io);
				RemoveFolder(staging);
				return;
			}
			for (var attempt = 0; ; attempt++)
			{
				try
				{
					Directory.Move(staging, io);
					return;
				}
				catch (Exception error)
				{
					if (attempt < 12 && (error is IOException || error is UnauthorizedAccessException))
					{
						Thread.Sleep(500);
						continue;
					}
					Directory.Move(previous, io);
					throw;
				}
			}
		}

		void FailUpdate(string message, bool openPrevious)
		{
			ExitCode = 1;
			var reopen = openPrevious && Relaunch && File.Exists(Path.Combine(io, "runtime", "Open Historia.exe"));
			Say(message + (reopen ? " Opening the version you have…" : ""), -1f);
			Thread.Sleep(5000);
			if (reopen)
			{
				try
				{
					Launch(target);
				}
				catch (Exception)
				{
				}
			}
			Invoke((MethodInvoker)Close);
		}

		void RunUpdate()
		{
			var stamp = Process.GetCurrentProcess().Id.ToString();
			var staging = io + ".update-" + stamp;
			var previous = io + ".previous-" + stamp;
			try
			{
				if (!File.Exists(Path.Combine(io, Marker)))
				{
					FailUpdate("The folder " + target + " is not an installation of " + AppName + ", so it was left alone.", false);
					return;
				}
				Say("Unpacking the update…", 0f);
				RemoveLeftovers(io);
				Extract(staging, 0f, 0.85f, "Unpacking the update…");
				var names = ExeNames(io);
				names.UnionWith(ExeNames(staging));
				Say("Waiting for the game to close…", 0.85f);
				if (!WaitForClose(target, names, 15000))
				{
					Say("Closing the running game…", 0.87f);
					StopRunning(target, names);
				}
				var uninstall = Path.Combine(io, "uninstall.ps1");
				if (File.Exists(uninstall)) File.Copy(uninstall, Path.Combine(staging, "uninstall.ps1"), true);
				Say("Replacing the previous version…", 0.92f);
				Swap(staging, previous, names);
				if (Relaunch)
				{
					Say("Starting " + AppName + "…", 1f);
					Launch(target);
				}
				else
				{
					RefreshShortcuts(target);
					Say("Updated. The game opens on the new version next time.", 1f);
				}
				try
				{
					RemoveFolder(previous);
				}
				catch (Exception)
				{
				}
				Thread.Sleep(Relaunch ? 900 : 1500);
				Invoke((MethodInvoker)Close);
			}
			catch (Exception error)
			{
				try
				{
					RemoveFolder(staging);
				}
				catch (Exception)
				{
				}
				FailUpdate("The update could not be installed: " + error.Message, true);
			}
		}

		void Run()
		{
			try
			{
				if (Directory.Exists(io))
				{
					if (!File.Exists(Path.Combine(io, Marker)))
					{
						Fail("The folder " + target + " already exists and was not made by this installer, so it was left alone.");
						return;
					}
					Say("Closing the running game…", 0f);
					StopRunning(target, ExeNames(io));
					Say("Removing the previous version…", 0f);
					Directory.Delete(io, true);
				}
				Extract(io, 0f, 1f, "Installing…");
				if (Unattended)
				{
					Invoke((MethodInvoker)Close);
					return;
				}
				Say("Adding shortcuts…", 1f);
				var godot = Path.Combine(target, "runtime", "Open Historia.exe");
				var icon = Path.Combine(target, "runtime", "open-historia.ico");
				var shellType = Type.GetTypeFromProgID("WScript.Shell");
				var shell = Activator.CreateInstance(shellType);
				foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Programs), Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory) })
				{
					var link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(folder, AppName + ".lnk") });
					var linkType = link.GetType();
					linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { godot });
					linkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { LaunchArguments(target) });
					linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { target });
					linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { icon });
					linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { AppName });
					linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
				}
				var uninstall = Path.Combine(target, "uninstall.ps1");
				File.WriteAllText(Path.Combine(io, "uninstall.ps1"), string.Join("\r\n", new[]
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
				Launch(target);
				Thread.Sleep(900);
				Invoke((MethodInvoker)Close);
			}
			catch (Exception error)
			{
				Fail(error.Message);
			}
		}

		[STAThread]
		static int Main(string[] args)
		{
			AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
			AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
			for (var index = 0; index < args.Length; index++)
			{
				if (args[index] == "--to" && index + 1 < args.Length)
				{
					TargetOverride = args[++index];
					Unattended = true;
				}
				else if (args[index] == "--update" && index + 1 < args.Length)
				{
					TargetOverride = args[++index];
					Updating = true;
				}
				else if (args[index] == "--no-relaunch")
				{
					Relaunch = false;
				}
				else if ((args[index] == "--apply-staged" || args[index] == "--rollback") && index + 1 < args.Length)
				{
					StageMode = args[index] == "--rollback" ? "rollback" : "apply";
					StageDir = args[++index];
				}
			}
			if (StageMode.Length > 0)
			{
				try
				{
					Plan = ReadPlan(StageDir);
				}
				catch (Exception error)
				{
					MessageBox.Show(AppName + " could not be updated.\n\n" + error.Message, AppName + " Update", MessageBoxButtons.OK, MessageBoxIcon.Error);
					return 1;
				}
				TargetOverride = PlanValue("install");
				Updating = true;
				if (TargetOverride.Length == 0) return 1;
			}
			Application.EnableVisualStyles();
			Application.SetCompatibleTextRenderingDefault(false);
			Application.Run(new SetupForm());
			return ExitCode;
		}
	}
}
