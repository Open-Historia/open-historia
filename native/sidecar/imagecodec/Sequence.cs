using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace OpenHistoriaImageCodec
{
	[ComImport, Guid("2cd2d921-c447-44a7-a13c-4adabfc247e3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMFAttributes
	{
		void GetItem(ref Guid key, IntPtr value);
		void GetItemType(ref Guid key, out int type);
		void CompareItem(ref Guid key, IntPtr value, out int result);
		void Compare(IMFAttributes other, int match, out int result);
		[PreserveSig] int GetUINT32(ref Guid key, out int value);
		[PreserveSig] int GetUINT64(ref Guid key, out long value);
		void GetDouble(ref Guid key, out double value);
		[PreserveSig] int GetGUID(ref Guid key, out Guid value);
		void GetStringLength(ref Guid key, out int length);
		void GetString(ref Guid key, IntPtr buffer, int size, IntPtr length);
		void GetAllocatedString(ref Guid key, out IntPtr value, out int length);
		void GetBlobSize(ref Guid key, out int size);
		void GetBlob(ref Guid key, IntPtr buffer, int size, IntPtr written);
		void GetAllocatedBlob(ref Guid key, out IntPtr buffer, out int size);
		void GetUnknown(ref Guid key, ref Guid riid, out IntPtr value);
		void SetItem(ref Guid key, IntPtr value);
		void DeleteItem(ref Guid key);
		void DeleteAllItems();
		void SetUINT32(ref Guid key, int value);
		void SetUINT64(ref Guid key, long value);
		void SetDouble(ref Guid key, double value);
		void SetGUID(ref Guid key, ref Guid value);
		void SetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value);
		void SetBlob(ref Guid key, IntPtr buffer, int size);
		void SetUnknown(ref Guid key, IntPtr value);
		void LockStore();
		void UnlockStore();
		void GetCount(out int count);
		void GetItemByIndex(int index, out Guid key, IntPtr value);
		void CopyAllItems(IMFAttributes destination);
	}

	[ComImport, Guid("44ae0fa8-ea31-4109-8d2e-4cae4997c555"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMFMediaType
	{
		void GetItem(ref Guid key, IntPtr value);
		void GetItemType(ref Guid key, out int type);
		void CompareItem(ref Guid key, IntPtr value, out int result);
		void Compare(IMFAttributes other, int match, out int result);
		[PreserveSig] int GetUINT32(ref Guid key, out int value);
		[PreserveSig] int GetUINT64(ref Guid key, out long value);
		void GetDouble(ref Guid key, out double value);
		[PreserveSig] int GetGUID(ref Guid key, out Guid value);
		void GetStringLength(ref Guid key, out int length);
		void GetString(ref Guid key, IntPtr buffer, int size, IntPtr length);
		void GetAllocatedString(ref Guid key, out IntPtr value, out int length);
		void GetBlobSize(ref Guid key, out int size);
		void GetBlob(ref Guid key, IntPtr buffer, int size, IntPtr written);
		void GetAllocatedBlob(ref Guid key, out IntPtr buffer, out int size);
		void GetUnknown(ref Guid key, ref Guid riid, out IntPtr value);
		void SetItem(ref Guid key, IntPtr value);
		void DeleteItem(ref Guid key);
		void DeleteAllItems();
		void SetUINT32(ref Guid key, int value);
		void SetUINT64(ref Guid key, long value);
		void SetDouble(ref Guid key, double value);
		void SetGUID(ref Guid key, ref Guid value);
		void SetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value);
		void SetBlob(ref Guid key, IntPtr buffer, int size);
		void SetUnknown(ref Guid key, IntPtr value);
		void LockStore();
		void UnlockStore();
		void GetCount(out int count);
		void GetItemByIndex(int index, out Guid key, IntPtr value);
		void CopyAllItems(IMFAttributes destination);
		void GetMajorType(out Guid major);
		void IsCompressedFormat(out int compressed);
		void IsEqual(IMFMediaType other, out int flags);
		void GetRepresentation(Guid representation, out IntPtr value);
		void FreeRepresentation(Guid representation, IntPtr value);
	}

	[ComImport, Guid("045FA593-8799-42b8-BC8D-8968C6453507"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMFMediaBuffer
	{
		void Lock(out IntPtr buffer, out int max, out int current);
		void Unlock();
		void GetCurrentLength(out int length);
		void SetCurrentLength(int length);
		void GetMaxLength(out int length);
	}

	[ComImport, Guid("c40a00f2-b93a-4d80-ae8c-5a1c634f58e4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMFSample
	{
		void GetItem(ref Guid key, IntPtr value);
		void GetItemType(ref Guid key, out int type);
		void CompareItem(ref Guid key, IntPtr value, out int result);
		void Compare(IMFAttributes other, int match, out int result);
		[PreserveSig] int GetUINT32(ref Guid key, out int value);
		[PreserveSig] int GetUINT64(ref Guid key, out long value);
		void GetDouble(ref Guid key, out double value);
		[PreserveSig] int GetGUID(ref Guid key, out Guid value);
		void GetStringLength(ref Guid key, out int length);
		void GetString(ref Guid key, IntPtr buffer, int size, IntPtr length);
		void GetAllocatedString(ref Guid key, out IntPtr value, out int length);
		void GetBlobSize(ref Guid key, out int size);
		void GetBlob(ref Guid key, IntPtr buffer, int size, IntPtr written);
		void GetAllocatedBlob(ref Guid key, out IntPtr buffer, out int size);
		void GetUnknown(ref Guid key, ref Guid riid, out IntPtr value);
		void SetItem(ref Guid key, IntPtr value);
		void DeleteItem(ref Guid key);
		void DeleteAllItems();
		void SetUINT32(ref Guid key, int value);
		void SetUINT64(ref Guid key, long value);
		void SetDouble(ref Guid key, double value);
		void SetGUID(ref Guid key, ref Guid value);
		void SetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value);
		void SetBlob(ref Guid key, IntPtr buffer, int size);
		void SetUnknown(ref Guid key, IntPtr value);
		void LockStore();
		void UnlockStore();
		void GetCount(out int count);
		void GetItemByIndex(int index, out Guid key, IntPtr value);
		void CopyAllItems(IMFAttributes destination);
		void GetSampleFlags(out int flags);
		void SetSampleFlags(int flags);
		void GetSampleTime(out long time);
		void SetSampleTime(long time);
		void GetSampleDuration(out long duration);
		void SetSampleDuration(long duration);
		void GetBufferCount(out int count);
		void GetBufferByIndex(int index, out IMFMediaBuffer buffer);
		void ConvertToContiguousBuffer(out IMFMediaBuffer buffer);
		void AddBuffer(IMFMediaBuffer buffer);
		void RemoveBufferByIndex(int index);
		void RemoveAllBuffers();
		void GetTotalLength(out int length);
		void CopyToBuffer(IMFMediaBuffer buffer);
	}

	[ComImport, Guid("70ae66f2-c809-4e4f-8915-bdcb406b7993"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IMFSourceReader
	{
		void GetStreamSelection(int stream, [MarshalAs(UnmanagedType.Bool)] out bool selected);
		void SetStreamSelection(int stream, [MarshalAs(UnmanagedType.Bool)] bool selected);
		[PreserveSig] int GetNativeMediaType(int stream, int index, out IMFMediaType type);
		void GetCurrentMediaType(int stream, out IMFMediaType type);
		[PreserveSig] int SetCurrentMediaType(int stream, IntPtr reserved, IMFMediaType type);
		void SetCurrentPosition(ref Guid format, IntPtr position);
		void ReadSample(int stream, int flags, out int actual, out int streamFlags, out long timestamp, out IMFSample sample);
		void Flush(int stream);
		void GetServiceForStream(int stream, ref Guid service, ref Guid riid, out IntPtr value);
		void GetPresentationAttribute(int stream, ref Guid key, IntPtr value);
	}

	sealed class Track
	{
		public uint Id;
		public string Handler = "";
		public int HandlerAt = -1;
		public ulong Duration;
		public bool IndefiniteDuration;
		public uint Timescale;
		public bool HasEdits;
		public bool Repeats;
		public ulong SegmentDuration;
		public int Width;
		public int Height;
		public bool Av01;
		public string AuxType = "";
		public List<uint> AuxlTargets = new List<uint>();
		public List<uint> Deltas = new List<uint>();
		public byte[] ConfigObus = new byte[0];
		public int[] Nclx;
		public long FirstOffset = -1;
		public long FirstSize;
	}

	sealed class Sequence
	{
		public uint MovieTimescale;
		public Track Color;
		public Track Alpha;
		public bool HasStill;
		public int SampleCount;

		const int MaxFrames = 256;
		const long PixelBudget = 24000000;
		static bool started;

		[DllImport("mfplat.dll", ExactSpelling = true)] static extern int MFStartup(int version, int flags);
		[DllImport("mfplat.dll", ExactSpelling = true)] static extern int MFShutdown();
		[DllImport("mfplat.dll", ExactSpelling = true)] static extern int MFCreateAttributes(out IMFAttributes attributes, int size);
		[DllImport("mfplat.dll", ExactSpelling = true)] static extern int MFCreateMediaType(out IMFMediaType type);
		[DllImport("mfreadwrite.dll", ExactSpelling = true)] static extern int MFCreateSourceReaderFromURL([MarshalAs(UnmanagedType.LPWStr)] string url, IMFAttributes attributes, out IMFSourceReader reader);

		static Guid MajorType = new Guid("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
		static Guid Subtype = new Guid("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
		static Guid Video = new Guid("73646976-0000-0010-8000-00AA00389B71");
		static Guid Nv12 = new Guid("3231564E-0000-0010-8000-00AA00389B71");
		static Guid P010 = new Guid("30313050-0000-0010-8000-00AA00389B71");
		static Guid FrameSize = new Guid("1652c33d-d6b2-4012-b834-72030849a37d");
		static Guid DefaultStride = new Guid("644b4e48-1e02-4516-b0eb-c01ca9d49ac6");

		public static void Stop()
		{
			if (started) MFShutdown();
			started = false;
		}

		static uint U16(byte[] data, int at)
		{
			return (uint)((data[at] << 8) | data[at + 1]);
		}

		static uint U32(byte[] data, int at)
		{
			return ((uint)data[at] << 24) | ((uint)data[at + 1] << 16) | ((uint)data[at + 2] << 8) | data[at + 3];
		}

		static ulong U64(byte[] data, int at)
		{
			return ((ulong)U32(data, at) << 32) | U32(data, at + 4);
		}

		sealed class Box
		{
			public string Type;
			public int Start;
			public int Body;
			public int End;
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
					size = (long)U64(data, at + 8);
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

		static Box Path(byte[] data, Box from, params string[] types)
		{
			var current = from;
			foreach (var type in types)
			{
				if (current == null) return null;
				current = Find(Boxes(data, current.Body, current.End), type);
			}
			return current;
		}

		public static Sequence Read(byte[] data)
		{
			try
			{
				var top = Boxes(data, 0, data.Length);
				var ftyp = Find(top, "ftyp");
				var moov = Find(top, "moov");
				if (ftyp == null || moov == null || ftyp.Body + 4 > ftyp.End) return null;
				var major = Encoding.ASCII.GetString(data, ftyp.Body, 4);
				if (major == "avif") return null;
				var sequence = new Sequence { HasStill = Find(top, "meta") != null };
				var mvhd = Path(data, moov, "mvhd");
				if (mvhd != null) sequence.MovieTimescale = data[mvhd.Body] == 1 ? U32(data, mvhd.Body + 20) : U32(data, mvhd.Body + 12);
				var tracks = new List<Track>();
				foreach (var trak in Boxes(data, moov.Body, moov.End))
				{
					if (trak.Type != "trak") continue;
					var track = ReadTrack(data, trak);
					if (track != null) tracks.Add(track);
				}
				foreach (var track in tracks)
				{
					if (track.Av01 && track.Handler == "pict" && track.AuxlTargets.Count == 0)
					{
						sequence.Color = track;
						break;
					}
				}
				if (sequence.Color == null) return null;
				foreach (var track in tracks)
				{
					if (track == sequence.Color || !track.Av01 || !track.AuxlTargets.Contains(sequence.Color.Id)) continue;
					if (track.AuxType.Length == 0 || track.AuxType == "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha" || track.AuxType == "urn:mpeg:hevc:2015:auxid:1")
					{
						sequence.Alpha = track;
						break;
					}
				}
				sequence.SampleCount = sequence.Color.Deltas.Count;
				return sequence.SampleCount > 0 ? sequence : null;
			}
			catch (Exception)
			{
				return null;
			}
		}

		static Track ReadTrack(byte[] data, Box trak)
		{
			var track = new Track();
			var tkhd = Path(data, trak, "tkhd");
			if (tkhd == null) return null;
			if (data[tkhd.Body] == 1)
			{
				track.Id = U32(data, tkhd.Body + 20);
				track.Duration = U64(data, tkhd.Body + 28);
				track.IndefiniteDuration = track.Duration == ulong.MaxValue;
			}
			else
			{
				track.Id = U32(data, tkhd.Body + 12);
				track.Duration = U32(data, tkhd.Body + 20);
				track.IndefiniteDuration = track.Duration == uint.MaxValue;
			}
			var tref = Path(data, trak, "tref");
			if (tref != null)
			{
				foreach (var reference in Boxes(data, tref.Body, tref.End))
				{
					if (reference.Type != "auxl") continue;
					for (var at = reference.Body; at + 4 <= reference.End; at += 4) track.AuxlTargets.Add(U32(data, at));
				}
			}
			var elst = Path(data, trak, "edts", "elst");
			if (elst != null)
			{
				track.HasEdits = true;
				var version = data[elst.Body];
				track.Repeats = (data[elst.Body + 3] & 1) != 0;
				var count = U32(data, elst.Body + 4);
				if (count > 0) track.SegmentDuration = version == 1 ? U64(data, elst.Body + 8) : U32(data, elst.Body + 8);
			}
			var mdhd = Path(data, trak, "mdia", "mdhd");
			if (mdhd != null) track.Timescale = data[mdhd.Body] == 1 ? U32(data, mdhd.Body + 20) : U32(data, mdhd.Body + 12);
			var hdlr = Path(data, trak, "mdia", "hdlr");
			if (hdlr != null && hdlr.Body + 12 <= hdlr.End)
			{
				track.HandlerAt = hdlr.Body + 8;
				track.Handler = Encoding.ASCII.GetString(data, track.HandlerAt, 4);
			}
			var stbl = Path(data, trak, "mdia", "minf", "stbl");
			if (stbl == null) return track;
			var stsd = Path(data, stbl, "stsd");
			if (stsd != null)
			{
				var entries = Boxes(data, stsd.Body + 8, stsd.End);
				if (entries.Count > 0 && entries[0].Type == "av01" && entries[0].Body + 78 <= entries[0].End)
				{
					var entry = entries[0];
					track.Av01 = true;
					track.Width = (int)U16(data, entry.Body + 24);
					track.Height = (int)U16(data, entry.Body + 26);
					foreach (var child in Boxes(data, entry.Body + 78, entry.End))
					{
						if (child.Type == "av1C" && child.Body + 4 <= child.End)
						{
							track.ConfigObus = new byte[child.End - child.Body - 4];
							Array.Copy(data, child.Body + 4, track.ConfigObus, 0, track.ConfigObus.Length);
						}
						else if (child.Type == "colr" && child.Body + 11 <= child.End && Encoding.ASCII.GetString(data, child.Body, 4) == "nclx")
						{
							track.Nclx = new int[] { (int)U16(data, child.Body + 4), (int)U16(data, child.Body + 6), (int)U16(data, child.Body + 8), data[child.Body + 10] >> 7 };
						}
						else if (child.Type == "auxi" && child.Body + 4 < child.End)
						{
							var end = Array.IndexOf(data, (byte)0, child.Body + 4, child.End - child.Body - 4);
							track.AuxType = Encoding.ASCII.GetString(data, child.Body + 4, (end < 0 ? child.End : end) - child.Body - 4);
						}
					}
				}
			}
			var stsz = Path(data, stbl, "stsz");
			if (stsz != null && stsz.Body + 12 <= stsz.End)
			{
				var fixedSize = U32(data, stsz.Body + 4);
				track.FirstSize = fixedSize != 0 ? fixedSize : (stsz.Body + 16 <= stsz.End ? U32(data, stsz.Body + 12) : 0);
			}
			var stco = Path(data, stbl, "stco");
			var co64 = Path(data, stbl, "co64");
			if (stco != null && stco.Body + 12 <= stco.End && U32(data, stco.Body + 4) > 0) track.FirstOffset = U32(data, stco.Body + 8);
			else if (co64 != null && co64.Body + 16 <= co64.End && U32(data, co64.Body + 4) > 0) track.FirstOffset = (long)U64(data, co64.Body + 8);
			var stts = Path(data, stbl, "stts");
			if (stts != null)
			{
				var count = U32(data, stts.Body + 4);
				for (uint index = 0, at = (uint)stts.Body + 8; index < count && at + 8 <= stts.End; index++, at += 8)
				{
					var samples = U32(data, (int)at);
					var delta = U32(data, (int)at + 4);
					for (uint copy = 0; copy < samples && track.Deltas.Count < 100000; copy++) track.Deltas.Add(delta);
				}
			}
			return track;
		}

		public int Loops()
		{
			if (!Color.HasEdits) return -1;
			if (!Color.Repeats) return 0;
			if (Color.IndefiniteDuration || Color.SegmentDuration == 0) return -1;
			var times = Color.Duration / Color.SegmentDuration;
			if (Color.Duration % Color.SegmentDuration != 0) times++;
			return times > int.MaxValue ? -1 : (int)Math.Max(0, (long)times - 1);
		}

		public List<double> Durations()
		{
			var timescale = Color.Timescale == 0 ? 1000.0 : Color.Timescale;
			var list = new List<double>();
			foreach (var delta in Color.Deltas)
			{
				var seconds = delta / timescale;
				list.Add(seconds <= 0.010 ? 0.1 : seconds);
			}
			return list;
		}

		static byte[] Remux(byte[] data, Track track)
		{
			var copy = (byte[])data.Clone();
			Encoding.ASCII.GetBytes("isom").CopyTo(copy, 8);
			if (track.HandlerAt >= 0) Encoding.ASCII.GetBytes("vide").CopyTo(copy, track.HandlerAt);
			return copy;
		}

		static List<Plane> DecodeTrack(byte[] data, Track track, int limit)
		{
			var file = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "oh-avif-" + Guid.NewGuid().ToString("N") + ".mp4");
			File.WriteAllBytes(file, Remux(data, track));
			try
			{
				return DecodeStream(file, -4, limit);
			}
			finally
			{
				try
				{
					File.Delete(file);
				}
				catch (IOException)
				{
				}
			}
		}

		sealed class Plane
		{
			public byte[] Bytes;
			public int Stride;
			public int Rows;
			public bool Wide;
		}

		static List<Plane> DecodeStream(string file, int stream, int limit)
		{
			if (!started)
			{
				var status = MFStartup(0x20070, 1);
				if (status != 0) throw new COMException("Media Foundation did not start.", status);
				started = true;
			}
			IMFAttributes attributes;
			MFCreateAttributes(out attributes, 1);
			IMFSourceReader reader;
			var made = MFCreateSourceReaderFromURL(file, attributes, out reader);
			Marshal.ReleaseComObject(attributes);
			if (made != 0) throw new COMException("The picture sequence could not be opened.", made);
			var planes = new List<Plane>();
			try
			{
				reader.SetStreamSelection(-2, false);
				reader.SetStreamSelection(stream, true);
				var wide = false;
				var chosen = false;
				foreach (var format in new[] { Nv12, P010 })
				{
					IMFMediaType wanted;
					MFCreateMediaType(out wanted);
					var major = Video;
					var sub = format;
					wanted.SetGUID(ref MajorType, ref major);
					wanted.SetGUID(ref Subtype, ref sub);
					var set = reader.SetCurrentMediaType(stream, IntPtr.Zero, wanted);
					Marshal.ReleaseComObject(wanted);
					if (set == 0)
					{
						wide = format == P010;
						chosen = true;
						break;
					}
					if (set == unchecked((int)0xC00D5212)) throw new COMException("No AV1 decoder is installed.", set);
				}
				if (!chosen) throw new COMException("No AV1 decoder is installed.", unchecked((int)0xC00D5212));
				var stride = 0;
				var rows = 0;
				Action describe = () =>
				{
					IMFMediaType current;
					reader.GetCurrentMediaType(stream, out current);
					long size;
					current.GetUINT64(ref FrameSize, out size);
					int pitch;
					stride = current.GetUINT32(ref DefaultStride, out pitch) == 0 ? Math.Abs(pitch) : (int)(size >> 32) * (wide ? 2 : 1);
					rows = (int)(size & 0xffffffff);
					Marshal.ReleaseComObject(current);
				};
				describe();
				while (planes.Count < limit)
				{
					int actual, flags;
					long time;
					IMFSample sample;
					reader.ReadSample(stream, 0, out actual, out flags, out time, out sample);
					if ((flags & 1) != 0) throw new COMException("The picture sequence could not be decoded.", unchecked((int)0x80004005));
					if ((flags & 0x20) != 0) describe();
					if (sample != null)
					{
						IMFMediaBuffer buffer;
						sample.ConvertToContiguousBuffer(out buffer);
						IntPtr pointer;
						int max, length;
						buffer.Lock(out pointer, out max, out length);
						try
						{
							var bytes = new byte[length];
							Marshal.Copy(pointer, bytes, 0, length);
							var planeRows = rows;
							if (stride > 0 && (long)stride * rows * 3 / 2 > length) planeRows = (int)(length / stride * 2 / 3);
							planes.Add(new Plane { Bytes = bytes, Stride = stride, Rows = planeRows, Wide = wide });
						}
						finally
						{
							buffer.Unlock();
							Marshal.ReleaseComObject(buffer);
							Marshal.ReleaseComObject(sample);
						}
					}
					if ((flags & 2) != 0) break;
				}
			}
			finally
			{
				Marshal.ReleaseComObject(reader);
			}
			return planes;
		}

		sealed class Colour
		{
			public double Kr = 0.299;
			public double Kb = 0.114;
			public bool Identity;
			public bool Full;
		}

		static Colour ColourOf(byte[] data, Track track, bool alpha)
		{
			var colour = new Colour();
			int[] header = SequenceHeader(track.ConfigObus);
			if (header == null && track.FirstOffset >= 0 && track.FirstSize > 0 && track.FirstOffset + track.FirstSize <= data.Length)
			{
				var sample = new byte[track.FirstSize];
				Array.Copy(data, track.FirstOffset, sample, 0, track.FirstSize);
				header = SequenceHeader(sample);
			}
			var matrix = 2;
			if (header != null)
			{
				matrix = header[0];
				colour.Full = header[1] == 1;
			}
			if (!alpha && track.Nclx != null)
			{
				matrix = track.Nclx[2];
				colour.Full = track.Nclx[3] == 1;
			}
			switch (matrix)
			{
				case 0: colour.Identity = true; break;
				case 1: colour.Kr = 0.2126; colour.Kb = 0.0722; break;
				case 4: colour.Kr = 0.30; colour.Kb = 0.11; break;
				case 7: colour.Kr = 0.212; colour.Kb = 0.087; break;
				case 9:
				case 10: colour.Kr = 0.2627; colour.Kb = 0.0593; break;
			}
			return colour;
		}

		sealed class Bits
		{
			readonly byte[] data;
			int bit;
			readonly int end;

			public Bits(byte[] source, int from, int to)
			{
				data = source;
				bit = from * 8;
				end = to * 8;
			}

			public uint Read(int count)
			{
				uint value = 0;
				for (var index = 0; index < count; index++)
				{
					if (bit >= end) throw new EndOfStreamException();
					value = (value << 1) | (uint)((data[bit >> 3] >> (7 - (bit & 7))) & 1);
					bit++;
				}
				return value;
			}

			public void Uvlc()
			{
				var zeros = 0;
				while (Read(1) == 0 && zeros < 32) zeros++;
				if (zeros < 32) Read(zeros);
			}
		}

		static int[] SequenceHeader(byte[] obus)
		{
			try
			{
				var at = 0;
				while (at < obus.Length)
				{
					var head = obus[at];
					var type = (head >> 3) & 15;
					var extension = (head & 4) != 0;
					var sized = (head & 2) != 0;
					var cursor = at + 1 + (extension ? 1 : 0);
					var size = obus.Length - cursor;
					if (sized)
					{
						size = 0;
						for (var shift = 0; shift < 56; shift += 7)
						{
							var part = obus[cursor++];
							size |= (part & 0x7f) << shift;
							if ((part & 0x80) == 0) break;
						}
					}
					if (type == 1) return ParseSequenceHeader(obus, cursor, cursor + size);
					at = cursor + size;
				}
			}
			catch (Exception)
			{
			}
			return null;
		}

		static int[] ParseSequenceHeader(byte[] data, int from, int to)
		{
			var bits = new Bits(data, from, to);
			var profile = bits.Read(3);
			bits.Read(1);
			var reduced = bits.Read(1) == 1;
			if (reduced)
			{
				bits.Read(5);
			}
			else
			{
				var timing = bits.Read(1) == 1;
				var decoderModel = false;
				var delayLength = 0;
				if (timing)
				{
					bits.Read(32);
					bits.Read(32);
					if (bits.Read(1) == 1) bits.Uvlc();
					decoderModel = bits.Read(1) == 1;
					if (decoderModel)
					{
						delayLength = (int)bits.Read(5) + 1;
						bits.Read(32);
						bits.Read(5);
						bits.Read(5);
					}
				}
				var initialDelay = bits.Read(1) == 1;
				var points = bits.Read(5) + 1;
				for (var point = 0; point < points; point++)
				{
					bits.Read(12);
					var level = bits.Read(5);
					if (level > 7) bits.Read(1);
					if (decoderModel && bits.Read(1) == 1)
					{
						bits.Read(delayLength);
						bits.Read(delayLength);
						bits.Read(1);
					}
					if (initialDelay && bits.Read(1) == 1) bits.Read(4);
				}
			}
			var widthBits = (int)bits.Read(4) + 1;
			var heightBits = (int)bits.Read(4) + 1;
			bits.Read(widthBits);
			bits.Read(heightBits);
			if (!reduced && bits.Read(1) == 1)
			{
				bits.Read(4);
				bits.Read(3);
			}
			bits.Read(3);
			if (!reduced)
			{
				bits.Read(4);
				var orderHint = bits.Read(1) == 1;
				if (orderHint) bits.Read(2);
				var forceScreen = 2u;
				if (bits.Read(1) == 0) forceScreen = bits.Read(1);
				if (forceScreen > 0 && bits.Read(1) == 0) bits.Read(1);
				if (orderHint) bits.Read(3);
			}
			bits.Read(3);
			var high = bits.Read(1) == 1;
			if (profile == 2 && high) bits.Read(1);
			var mono = profile == 1 ? false : bits.Read(1) == 1;
			var primaries = 2u;
			var transfer = 2u;
			var matrix = 2u;
			if (bits.Read(1) == 1)
			{
				primaries = bits.Read(8);
				transfer = bits.Read(8);
				matrix = bits.Read(8);
			}
			var full = 0u;
			if (mono) full = bits.Read(1);
			else if (primaries == 1 && transfer == 13 && matrix == 0) full = 1;
			else full = bits.Read(1);
			return new int[] { (int)matrix, (int)full };
		}

		static byte Clamp(double value)
		{
			var scaled = Math.Round(value * 255.0);
			return (byte)(scaled < 0 ? 0 : scaled > 255 ? 255 : scaled);
		}

		static double Sample(Plane plane, int offset, int index)
		{
			if (!plane.Wide) return plane.Bytes[offset + index];
			var at = offset + index * 2;
			return ((plane.Bytes[at] | (plane.Bytes[at + 1] << 8)) >> 6) / 4.0;
		}

		static void ToBgra(Plane plane, int width, int height, Colour colour, byte[] output)
		{
			var lumaRange = colour.Full ? 255.0 : 219.0;
			var lumaBase = colour.Full ? 0.0 : 16.0;
			var chromaRange = colour.Full ? 255.0 : 224.0;
			var chromaOffset = plane.Stride * plane.Rows;
			var chromaWidth = (width + 1) / 2;
			var chromaHeight = (height + 1) / 2;
			var kg = 1.0 - colour.Kr - colour.Kb;
			for (var y = 0; y < height; y++)
			{
				var cy = Math.Max(0.0, Math.Min(chromaHeight - 1, (y + 0.5) / 2.0 - 0.5));
				var y0 = (int)Math.Floor(cy);
				var y1 = Math.Min(chromaHeight - 1, y0 + 1);
				var fy = cy - y0;
				for (var x = 0; x < width; x++)
				{
					var cx = Math.Max(0.0, Math.Min(chromaWidth - 1, (x + 0.5) / 2.0 - 0.5));
					var x0 = (int)Math.Floor(cx);
					var x1 = Math.Min(chromaWidth - 1, x0 + 1);
					var fx = cx - x0;
					var u = Bilinear(plane, chromaOffset, x0, x1, y0, y1, fx, fy, 0);
					var v = Bilinear(plane, chromaOffset, x0, x1, y0, y1, fx, fy, 1);
					var luma = (Sample(plane, y * plane.Stride, x) - lumaBase) / lumaRange;
					var cb = (u - 128.0) / chromaRange;
					var cr = (v - 128.0) / chromaRange;
					double r, g, b;
					if (colour.Identity)
					{
						g = luma;
						b = (u - lumaBase) / lumaRange;
						r = (v - lumaBase) / lumaRange;
					}
					else
					{
						r = luma + 2.0 * (1.0 - colour.Kr) * cr;
						b = luma + 2.0 * (1.0 - colour.Kb) * cb;
						g = (luma - colour.Kr * r - colour.Kb * b) / kg;
					}
					var at = (y * width + x) * 4;
					output[at] = Clamp(b);
					output[at + 1] = Clamp(g);
					output[at + 2] = Clamp(r);
					output[at + 3] = 255;
				}
			}
		}

		static double Bilinear(Plane plane, int offset, int x0, int x1, int y0, int y1, double fx, double fy, int channel)
		{
			var a = Sample(plane, offset + y0 * plane.Stride, x0 * 2 + channel);
			var b = Sample(plane, offset + y0 * plane.Stride, x1 * 2 + channel);
			var c = Sample(plane, offset + y1 * plane.Stride, x0 * 2 + channel);
			var d = Sample(plane, offset + y1 * plane.Stride, x1 * 2 + channel);
			return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
		}

		static void ApplyAlpha(Plane plane, int width, int height, Colour colour, byte[] output)
		{
			for (var y = 0; y < height; y++)
			{
				for (var x = 0; x < width; x++)
				{
					var level = Sample(plane, y * plane.Stride, x);
					output[(y * width + x) * 4 + 3] = Clamp(colour.Full ? level / 255.0 : (level - 16.0) / 219.0);
				}
			}
		}

		public static string Convert(byte[] data, Sequence sequence, string target, Func<byte[], int, int, string, bool> write)
		{
			var width = sequence.Color.Width;
			var height = sequence.Color.Height;
			if (width <= 0 || height <= 0) return "failed\tThe picture sequence has no size.";
			var budget = (int)Math.Max(1, Math.Min(MaxFrames, PixelBudget / Math.Max(1L, (long)width * height)));
			var limit = Math.Min(budget, sequence.SampleCount);
			var colourPlanes = DecodeTrack(data, sequence.Color, limit);
			if (colourPlanes.Count == 0) return "failed\tThe picture sequence has no pictures in it.";
			List<Plane> alphaPlanes = null;
			var alphaState = "none";
			if (sequence.Alpha != null)
			{
				try
				{
					alphaPlanes = DecodeTrack(data, sequence.Alpha, limit);
					alphaState = "track";
				}
				catch (Exception)
				{
					alphaState = "unreadable";
				}
			}
			var colour = ColourOf(data, sequence.Color, false);
			var alphaColour = sequence.Alpha != null ? ColourOf(data, sequence.Alpha, true) : null;
			var durations = sequence.Durations();
			var timings = new StringBuilder();
			for (var index = 0; index < colourPlanes.Count; index++)
			{
				var pixels = new byte[width * height * 4];
				ToBgra(colourPlanes[index], width, height, colour, pixels);
				if (alphaPlanes != null && index < alphaPlanes.Count) ApplyAlpha(alphaPlanes[index], width, height, alphaColour, pixels);
				var path = index == 0 ? target : FramePath(target, index);
				if (!write(pixels, width, height, path)) return "failed\tA picture of the sequence could not be saved.";
				if (index > 0) timings.Append(',');
				var seconds = index < durations.Count ? durations[index] : 0.1;
				timings.Append(seconds.ToString("0.######", CultureInfo.InvariantCulture));
			}
			return "ok\t" + width + "\t" + height + "\t" + alphaState + "\t" + colourPlanes.Count + "\t" + sequence.Loops() + "\t" + timings;
		}

		public static string FramePath(string target, int index)
		{
			var stem = target.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? target.Substring(0, target.Length - 4) : target;
			return stem + "." + index + ".png";
		}
	}
}
