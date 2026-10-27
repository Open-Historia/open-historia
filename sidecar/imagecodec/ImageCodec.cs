using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace OpenHistoriaImageCodec
{
	public static class Program
	{
		static readonly int[] MissingCodec = { unchecked((int)0x88982F50), unchecked((int)0x88982F8B), unchecked((int)0xC00D5212), unchecked((int)0x80040154) };

		sealed class Box
		{
			public string Type;
			public int Start;
			public int Body;
			public int End;
		}

		sealed class AlphaPlane
		{
			public byte[] Bytes;
			public List<KeyValuePair<string, int>> Transforms = new List<KeyValuePair<string, int>>();
		}

		[STAThread]
		public static int Main(string[] args)
		{
			AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
			AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
			var encoding = new UTF8Encoding(false);
			var input = new StreamReader(Console.OpenStandardInput(), encoding);
			var output = new StreamWriter(Console.OpenStandardOutput(), encoding);
			output.NewLine = "\n";
			output.AutoFlush = true;
			output.WriteLine("ready");
			string line;
			while ((line = input.ReadLine()) != null)
			{
				var parts = line.Split('\t');
				output.WriteLine(parts.Length < 2 ? "failed\tThe request was malformed." : Convert(parts[0], parts[1]));
			}
			return 0;
		}

		static string Clean(string text)
		{
			return (text ?? "").Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Trim();
		}

		static bool IsMissing(Exception error)
		{
			for (var current = error; current != null; current = current.InnerException)
			{
				if (current is NotSupportedException) return true;
				if (Array.IndexOf(MissingCodec, current.HResult) >= 0) return true;
			}
			return false;
		}

		static BitmapSource Decode(byte[] bytes)
		{
			using (var stream = new MemoryStream(bytes, false))
			{
				var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
				if (decoder.Frames.Count == 0) throw new FileFormatException("The image has no pictures in it.");
				return decoder.Frames[0];
			}
		}

		static byte[] Pixels(BitmapSource source)
		{
			var bgra = source.Format == PixelFormats.Bgra32 ? source : new FormatConvertedBitmap(source, PixelFormats.Bgra32, null, 0);
			var buffer = new byte[bgra.PixelWidth * bgra.PixelHeight * 4];
			bgra.CopyPixels(buffer, bgra.PixelWidth * 4, 0);
			return buffer;
		}

		static bool HasAlpha(PixelFormat format)
		{
			return format == PixelFormats.Bgra32 || format == PixelFormats.Pbgra32 || format == PixelFormats.Rgba64 || format == PixelFormats.Prgba64 || format == PixelFormats.Rgba128Float || format == PixelFormats.Prgba128Float;
		}

		static string Convert(string source, string target)
		{
			var partial = target + ".part";
			try
			{
				var bytes = File.ReadAllBytes(source);
				var frame = Decode(bytes);
				var width = frame.PixelWidth;
				var height = frame.PixelHeight;
				var buffer = Pixels(frame);
				var alpha = HasAlpha(frame.Format) ? "own" : "none";
				if (!HasAlpha(frame.Format))
				{
					var variant = AlphaVariant(bytes);
					if (variant != null)
					{
						try
						{
							var mask = Orient(Decode(variant.Bytes), variant.Transforms);
							if (mask.PixelWidth == width && mask.PixelHeight == height)
							{
								var levels = Pixels(mask);
								for (var at = 3; at < buffer.Length; at += 4) buffer[at] = levels[at - 2];
								alpha = "plane";
							}
						}
						catch (Exception)
						{
							alpha = "unreadable";
						}
					}
				}
				var image = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, buffer, width * 4);
				var encoder = new PngBitmapEncoder();
				encoder.Frames.Add(BitmapFrame.Create(image));
				Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(target)));
				using (var stream = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None))
				{
					encoder.Save(stream);
				}
				if (File.Exists(target)) File.Delete(target);
				File.Move(partial, target);
				return "ok\t" + width + "\t" + height + "\t" + alpha;
			}
			catch (Exception error)
			{
				try
				{
					if (File.Exists(partial)) File.Delete(partial);
				}
				catch (IOException)
				{
				}
				return (IsMissing(error) ? "missing\t" : "failed\t") + Clean(error.GetType().Name + ": " + error.Message);
			}
		}

		static BitmapSource Orient(BitmapSource source, List<KeyValuePair<string, int>> transforms)
		{
			var group = new TransformGroup();
			foreach (var step in transforms)
			{
				if (step.Key == "irot" && step.Value != 0) group.Children.Add(new RotateTransform((360 - 90 * step.Value) % 360));
				else if (step.Key == "imir") group.Children.Add(step.Value == 0 ? new ScaleTransform(1, -1) : new ScaleTransform(-1, 1));
			}
			return group.Children.Count == 0 ? source : new TransformedBitmap(source, group);
		}

		static uint U16(byte[] data, int at)
		{
			return (uint)((data[at] << 8) | data[at + 1]);
		}

		static uint U32(byte[] data, int at)
		{
			return ((uint)data[at] << 24) | ((uint)data[at + 1] << 16) | ((uint)data[at + 2] << 8) | data[at + 3];
		}

		static List<Box> Boxes(byte[] data, int from, int to)
		{
			var found = new List<Box>();
			var at = from;
			while (at + 8 <= to)
			{
				long size = U32(data, at);
				var header = 8;
				if (size == 1)
				{
					if (at + 16 > to) break;
					size = ((long)U32(data, at + 8) << 32) | U32(data, at + 12);
					header = 16;
				}
				else if (size == 0)
				{
					size = to - at;
				}
				if (size < header || at + size > to) break;
				found.Add(new Box { Type = Encoding.ASCII.GetString(data, at + 4, 4), Start = at, Body = at + header, End = (int)(at + size) });
				at = (int)(at + size);
			}
			return found;
		}

		static Box Find(List<Box> boxes, string type)
		{
			foreach (var box in boxes)
			{
				if (box.Type == type) return box;
			}
			return null;
		}

		static AlphaPlane AlphaVariant(byte[] data)
		{
			try
			{
				var meta = Find(Boxes(data, 0, data.Length), "meta");
				if (meta == null) return null;
				var children = Boxes(data, meta.Body + 4, meta.End);
				var pitm = Find(children, "pitm");
				var iref = Find(children, "iref");
				var iprp = Find(children, "iprp");
				if (pitm == null || iref == null || iprp == null) return null;
				var pitmWide = data[pitm.Body] != 0;
				var pitmAt = pitm.Body + 4;
				var primary = pitmWide ? U32(data, pitmAt) : U16(data, pitmAt);
				var refWide = data[iref.Body] != 0;
				var step = refWide ? 4 : 2;
				var candidates = new List<uint>();
				foreach (var reference in Boxes(data, iref.Body + 4, iref.End))
				{
					if (reference.Type != "auxl") continue;
					var at = reference.Body;
					var from = refWide ? U32(data, at) : U16(data, at);
					at += step;
					var count = (int)U16(data, at);
					at += 2;
					for (var index = 0; index < count && at + step <= reference.End; index++, at += step)
					{
						if ((refWide ? U32(data, at) : U16(data, at)) == primary) candidates.Add(from);
					}
				}
				if (candidates.Count == 0) return null;
				var parts = Boxes(data, iprp.Body, iprp.End);
				var ipco = Find(parts, "ipco");
				var ipma = Find(parts, "ipma");
				if (ipco == null || ipma == null) return null;
				var properties = Boxes(data, ipco.Body, ipco.End);
				var ipmaWide = data[ipma.Body] != 0;
				var bigIndex = (data[ipma.Body + 3] & 1) != 0;
				var cursor = ipma.Body + 4;
				var entries = U32(data, cursor);
				cursor += 4;
				uint alpha = 0;
				var plane = new AlphaPlane();
				var shown = new Dictionary<uint, List<KeyValuePair<string, int>>>();
				for (uint entry = 0; entry < entries && cursor < ipma.End; entry++)
				{
					var item = ipmaWide ? U32(data, cursor) : U16(data, cursor);
					cursor += ipmaWide ? 4 : 2;
					var associations = data[cursor];
					cursor += 1;
					for (var index = 0; index < associations; index++)
					{
						var property = bigIndex ? (int)(U16(data, cursor) & 0x7FFF) : data[cursor] & 0x7F;
						cursor += bigIndex ? 2 : 1;
						if (property < 1 || property > properties.Count) continue;
						var transform = properties[property - 1];
						if ((transform.Type == "irot" || transform.Type == "imir") && transform.Body < transform.End)
						{
							if (!shown.ContainsKey(item)) shown[item] = new List<KeyValuePair<string, int>>();
							shown[item].Add(new KeyValuePair<string, int>(transform.Type, data[transform.Body] & (transform.Type == "irot" ? 3 : 1)));
						}
						if (alpha != 0 || !candidates.Contains(item)) continue;
						var box = properties[property - 1];
						if (box.Type != "auxC" || box.Body + 4 >= box.End) continue;
						var end = Array.IndexOf(data, (byte)0, box.Body + 4, box.End - box.Body - 4);
						var kind = Encoding.ASCII.GetString(data, box.Body + 4, (end < 0 ? box.End : end) - box.Body - 4);
						if (kind == "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha" || kind == "urn:mpeg:hevc:2015:auxid:1") alpha = item;
					}
				}
				if (alpha == 0 || (!pitmWide && alpha > 0xFFFF)) return null;
				var copy = (byte[])data.Clone();
				plane.Bytes = copy;
				if (!shown.ContainsKey(alpha) && shown.ContainsKey(primary)) plane.Transforms = shown[primary];
				if (pitmWide)
				{
					copy[pitmAt] = (byte)(alpha >> 24);
					copy[pitmAt + 1] = (byte)(alpha >> 16);
					copy[pitmAt + 2] = (byte)(alpha >> 8);
					copy[pitmAt + 3] = (byte)alpha;
				}
				else
				{
					copy[pitmAt] = (byte)(alpha >> 8);
					copy[pitmAt + 1] = (byte)alpha;
				}
				return plane;
			}
			catch (Exception)
			{
				return null;
			}
		}
	}
}
