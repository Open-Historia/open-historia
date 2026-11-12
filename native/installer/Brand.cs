using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace OpenHistoriaBrand
{
	public static class Program
	{
		const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
		static readonly IntPtr RT_ICON = (IntPtr)3;
		static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;
		static readonly IntPtr RT_VERSION = (IntPtr)16;

		delegate bool EnumNamesProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
		delegate bool EnumLanguagesProc(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);

		[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
		static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
		[DllImport("kernel32.dll", SetLastError = true)]
		static extern bool FreeLibrary(IntPtr module);
		[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
		static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNamesProc callback, IntPtr param);
		[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
		static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLanguagesProc callback, IntPtr param);
		[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
		static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
		[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
		static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
		[DllImport("kernel32.dll", SetLastError = true)]
		static extern bool EndUpdateResource(IntPtr update, bool discard);

		sealed class Entry
		{
			public IntPtr Type;
			public IntPtr Name;
			public string NameText;
			public ushort Language;
		}

		static bool IsIntResource(IntPtr value)
		{
			return ((ulong)value.ToInt64() >> 16) == 0;
		}

		static List<Entry> Existing(string exe, IntPtr type)
		{
			var found = new List<Entry>();
			var module = LoadLibraryEx(exe, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
			if (module == IntPtr.Zero) throw new Exception("Could not open " + exe);
			try
			{
				var names = new List<KeyValuePair<IntPtr, string>>();
				EnumResourceNames(module, type, (m, t, name, p) =>
				{
					names.Add(IsIntResource(name) ? new KeyValuePair<IntPtr, string>(name, null) : new KeyValuePair<IntPtr, string>(IntPtr.Zero, Marshal.PtrToStringUni(name)));
					return true;
				}, IntPtr.Zero);
				foreach (var pair in names)
				{
					var handle = pair.Value == null ? pair.Key : Marshal.StringToHGlobalUni(pair.Value);
					try
					{
						EnumResourceLanguages(module, type, handle, (m, t, n, language, p) =>
						{
							found.Add(new Entry { Type = type, Name = pair.Key, NameText = pair.Value, Language = language });
							return true;
						}, IntPtr.Zero);
					}
					finally
					{
						if (pair.Value != null) Marshal.FreeHGlobal(handle);
					}
				}
			}
			finally
			{
				FreeLibrary(module);
			}
			return found;
		}

		static void Write(IntPtr update, Entry entry, byte[] data)
		{
			var handle = entry.NameText == null ? entry.Name : Marshal.StringToHGlobalUni(entry.NameText);
			try
			{
				if (!UpdateResource(update, entry.Type, handle, entry.Language, data, data == null ? 0u : (uint)data.Length))
				{
					throw new Exception("UpdateResource failed: " + Marshal.GetLastWin32Error());
				}
			}
			finally
			{
				if (entry.NameText != null) Marshal.FreeHGlobal(handle);
			}
		}

		static void Pad(BinaryWriter writer)
		{
			while (writer.BaseStream.Position % 4 != 0) writer.Write((byte)0);
		}

		static byte[] Block(string key, ushort type, byte[] value, ushort valueLength, List<byte[]> children)
		{
			using (var stream = new MemoryStream())
			using (var writer = new BinaryWriter(stream))
			{
				writer.Write((ushort)0);
				writer.Write(valueLength);
				writer.Write(type);
				writer.Write(Encoding.Unicode.GetBytes(key + "\0"));
				Pad(writer);
				if (value != null) writer.Write(value);
				Pad(writer);
				if (children != null)
				{
					foreach (var child in children)
					{
						writer.Write(child);
						Pad(writer);
					}
				}
				var bytes = stream.ToArray();
				var length = BitConverter.GetBytes((ushort)bytes.Length);
				bytes[0] = length[0];
				bytes[1] = length[1];
				return bytes;
			}
		}

		static byte[] StringBlock(string key, string value)
		{
			var text = Encoding.Unicode.GetBytes(value + "\0");
			return Block(key, 1, text, (ushort)(value.Length + 1), null);
		}

		static byte[] VersionInfo(string product, string description, string company, string file, ushort[] version)
		{
			byte[] fixedInfo;
			using (var stream = new MemoryStream())
			using (var writer = new BinaryWriter(stream))
			{
				writer.Write(0xFEEF04BDu);
				writer.Write(0x00010000u);
				writer.Write(((uint)version[0] << 16) | version[1]);
				writer.Write(((uint)version[2] << 16) | version[3]);
				writer.Write(((uint)version[0] << 16) | version[1]);
				writer.Write(((uint)version[2] << 16) | version[3]);
				writer.Write(0x3Fu);
				writer.Write(0u);
				writer.Write(0x40004u);
				writer.Write(1u);
				writer.Write(0u);
				writer.Write(0u);
				writer.Write(0u);
				fixedInfo = stream.ToArray();
			}
			var versionText = string.Join(".", Array.ConvertAll(version, v => v.ToString()));
			var strings = new List<byte[]>
			{
				StringBlock("CompanyName", company),
				StringBlock("FileDescription", description),
				StringBlock("FileVersion", versionText),
				StringBlock("InternalName", product),
				StringBlock("LegalCopyright", "Open Historia contributors"),
				StringBlock("OriginalFilename", file),
				StringBlock("ProductName", product),
				StringBlock("ProductVersion", versionText),
			};
			var table = Block("040904b0", 1, null, 0, strings);
			var stringInfo = Block("StringFileInfo", 1, null, 0, new List<byte[]> { table });
			var translation = Block("Translation", 0, new byte[] { 0x09, 0x04, 0xB0, 0x04 }, 4, null);
			var varInfo = Block("VarFileInfo", 1, null, 0, new List<byte[]> { translation });
			return Block("VS_VERSION_INFO", 0, fixedInfo, (ushort)fixedInfo.Length, new List<byte[]> { stringInfo, varInfo });
		}

		public static int Main(string[] args)
		{
			if (args.Length < 3)
			{
				Console.Error.WriteLine("usage: brand <exe> <icon.ico> <product name>");
				return 2;
			}
			var exe = Path.GetFullPath(args[0]);
			var ico = File.ReadAllBytes(args[1]);
			var product = args[2];
			var icons = Existing(exe, RT_ICON);
			var groups = Existing(exe, RT_GROUP_ICON);
			var versions = Existing(exe, RT_VERSION);
			var count = BitConverter.ToUInt16(ico, 4);
			var images = new List<byte[]>();
			var directory = new List<byte[]>();
			for (var index = 0; index < count; index++)
			{
				var at = 6 + index * 16;
				var bytes = BitConverter.ToUInt32(ico, at + 8);
				var offset = BitConverter.ToUInt32(ico, at + 12);
				var image = new byte[bytes];
				Array.Copy(ico, (int)offset, image, 0, (int)bytes);
				images.Add(image);
				var entry = new byte[14];
				Array.Copy(ico, at, entry, 0, 12);
				var id = BitConverter.GetBytes((ushort)(index + 1));
				entry[12] = id[0];
				entry[13] = id[1];
				directory.Add(entry);
			}
			var group = new List<byte>();
			group.AddRange(new byte[] { 0, 0, 1, 0 });
			group.AddRange(BitConverter.GetBytes((ushort)count));
			foreach (var entry in directory) group.AddRange(entry);
			var update = BeginUpdateResource(exe, false);
			if (update == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
			try
			{
				foreach (var entry in icons) Write(update, entry, null);
				foreach (var entry in groups) Write(update, entry, null);
				foreach (var entry in versions) Write(update, entry, null);
				for (var index = 0; index < images.Count; index++)
				{
					Write(update, new Entry { Type = RT_ICON, Name = (IntPtr)(index + 1), Language = 0x0409 }, images[index]);
				}
				Write(update, new Entry { Type = RT_GROUP_ICON, Name = (IntPtr)1, Language = 0x0409 }, group.ToArray());
				Write(update, new Entry { Type = RT_VERSION, Name = (IntPtr)1, Language = 0x0409 }, VersionInfo(product, product, "Open Historia", Path.GetFileName(exe), new ushort[] { 1, 0, 0, 0 }));
			}
			catch
			{
				EndUpdateResource(update, true);
				throw;
			}
			if (!EndUpdateResource(update, false)) throw new Exception("EndUpdateResource failed: " + Marshal.GetLastWin32Error());
			Console.WriteLine("branded " + exe + ": " + icons.Count + " icons and " + groups.Count + " icon groups replaced, version set to " + product);
			return 0;
		}
	}
}
