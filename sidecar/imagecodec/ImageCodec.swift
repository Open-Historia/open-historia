import CoreGraphics
import Foundation
import ImageIO

let maxFrames = 256
let pixelBudget = 24_000_000
let alphaKinds: Set<String> = ["urn:mpeg:mpegB:cicp:systems:auxiliary:alpha", "urn:mpeg:hevc:2015:auxid:1"]
let unsupported = "missing\tThis version of macOS cannot read AVIF images."

struct CodecFailure: Error {
	let message: String
}

struct Box {
	let type: String
	let start: Int
	let body: Int
	let end: Int
}

struct Bytes {
	let data: [UInt8]

	func u8(_ at: Int) -> Int {
		return at >= 0 && at < data.count ? Int(data[at]) : 0
	}

	func u16(_ at: Int) -> Int {
		return (u8(at) << 8) | u8(at + 1)
	}

	func u32(_ at: Int) -> UInt64 {
		return (UInt64(u8(at)) << 24) | (UInt64(u8(at + 1)) << 16) | (UInt64(u8(at + 2)) << 8) | UInt64(u8(at + 3))
	}

	func u64(_ at: Int) -> UInt64 {
		return (u32(at) << 32) | u32(at + 4)
	}

	func text(_ from: Int, _ count: Int) -> String {
		if from < 0 || count < 0 || from + count > data.count {
			return ""
		}
		return String(decoding: data[from..<(from + count)], as: UTF8.self)
	}

	func cString(_ from: Int, _ to: Int) -> String {
		let limit = min(to, data.count)
		if from < 0 || from >= limit {
			return ""
		}
		var end = from
		while end < limit && data[end] != 0 {
			end += 1
		}
		return String(decoding: data[from..<end], as: UTF8.self)
	}

	func boxes(_ from: Int, _ to: Int) -> [Box] {
		var found: [Box] = []
		let limit = min(to, data.count)
		var at = from
		while at >= 0 && at + 8 <= limit {
			var size = u32(at)
			var header = 8
			if size == 1 {
				if at + 16 > limit {
					break
				}
				size = u64(at + 8)
				header = 16
			} else if size == 0 {
				size = UInt64(limit - at)
			}
			if size < UInt64(header) || size > UInt64(limit - at) {
				break
			}
			let end = at + Int(size)
			found.append(Box(type: text(at + 4, 4), start: at, body: at + header, end: end))
			at = end
		}
		return found
	}

	func find(_ list: [Box], _ type: String) -> Box? {
		return list.first(where: { $0.type == type })
	}

	func path(_ from: Box?, _ types: [String]) -> Box? {
		var current = from
		for type in types {
			guard let box = current else {
				return nil
			}
			current = find(boxes(box.body, box.end), type)
		}
		return current
	}
}

final class Track {
	var id = 0
	var handler = ""
	var duration: UInt64 = 0
	var indefinite = false
	var timescale = 0
	var hasEdits = false
	var repeats = false
	var segment: UInt64 = 0
	var width = 0
	var height = 0
	var av01 = false
	var auxType = ""
	var auxlTargets: [Int] = []
	var deltas: [Int] = []
}

final class Animation {
	let color: Track
	var alpha: Track? = nil
	var hasStill = false

	init(color: Track) {
		self.color = color
	}

	func loops() -> Int {
		if !color.hasEdits {
			return -1
		}
		if !color.repeats {
			return 0
		}
		if color.indefinite || color.segment == 0 {
			return -1
		}
		var times = color.duration / color.segment
		if color.duration % color.segment != 0 {
			times += 1
		}
		if times > UInt64(Int32.max) {
			return -1
		}
		return max(0, Int(times) - 1)
	}

	func durations() -> [Double] {
		let scale = color.timescale == 0 ? 1000.0 : Double(color.timescale)
		return color.deltas.map { Double($0) / scale }
	}
}

func readTrack(_ bytes: Bytes, _ trak: Box) -> Track? {
	let track = Track()
	guard let tkhd = bytes.path(trak, ["tkhd"]) else {
		return nil
	}
	if bytes.u8(tkhd.body) == 1 {
		track.id = Int(bytes.u32(tkhd.body + 20))
		track.duration = bytes.u64(tkhd.body + 28)
		track.indefinite = track.duration == UInt64.max
	} else {
		track.id = Int(bytes.u32(tkhd.body + 12))
		track.duration = bytes.u32(tkhd.body + 20)
		track.indefinite = track.duration == UInt64(UInt32.max)
	}
	if let tref = bytes.path(trak, ["tref"]) {
		for reference in bytes.boxes(tref.body, tref.end) where reference.type == "auxl" {
			var at = reference.body
			while at + 4 <= reference.end {
				track.auxlTargets.append(Int(bytes.u32(at)))
				at += 4
			}
		}
	}
	if let elst = bytes.path(trak, ["edts", "elst"]) {
		track.hasEdits = true
		track.repeats = (bytes.u8(elst.body + 3) & 1) != 0
		if bytes.u32(elst.body + 4) > 0 {
			track.segment = bytes.u8(elst.body) == 1 ? bytes.u64(elst.body + 8) : bytes.u32(elst.body + 8)
		}
	}
	if let mdhd = bytes.path(trak, ["mdia", "mdhd"]) {
		track.timescale = Int(bytes.u8(mdhd.body) == 1 ? bytes.u32(mdhd.body + 20) : bytes.u32(mdhd.body + 12))
	}
	if let hdlr = bytes.path(trak, ["mdia", "hdlr"]), hdlr.body + 12 <= hdlr.end {
		track.handler = bytes.text(hdlr.body + 8, 4)
	}
	guard let stbl = bytes.path(trak, ["mdia", "minf", "stbl"]) else {
		return track
	}
	if let stsd = bytes.path(stbl, ["stsd"]), let entry = bytes.boxes(stsd.body + 8, stsd.end).first, entry.type == "av01", entry.body + 78 <= entry.end {
		track.av01 = true
		track.width = bytes.u16(entry.body + 24)
		track.height = bytes.u16(entry.body + 26)
		for child in bytes.boxes(entry.body + 78, entry.end) where child.type == "auxi" && child.body + 4 < child.end {
			track.auxType = bytes.cString(child.body + 4, child.end)
		}
	}
	if let stts = bytes.path(stbl, ["stts"]) {
		let count = Int(bytes.u32(stts.body + 4))
		var at = stts.body + 8
		var index = 0
		while index < count && at + 8 <= stts.end {
			let samples = Int(bytes.u32(at))
			let delta = Int(bytes.u32(at + 4))
			var copy = 0
			while copy < samples && track.deltas.count < 100_000 {
				track.deltas.append(delta)
				copy += 1
			}
			index += 1
			at += 8
		}
	}
	return track
}

func readAnimation(_ bytes: Bytes) -> Animation? {
	let top = bytes.boxes(0, bytes.data.count)
	guard let ftyp = bytes.find(top, "ftyp"), let moov = bytes.find(top, "moov"), ftyp.body + 4 <= ftyp.end else {
		return nil
	}
	if bytes.text(ftyp.body, 4) == "avif" {
		return nil
	}
	var tracks: [Track] = []
	for trak in bytes.boxes(moov.body, moov.end) where trak.type == "trak" {
		if let track = readTrack(bytes, trak) {
			tracks.append(track)
		}
	}
	guard let color = tracks.first(where: { $0.av01 && $0.handler == "pict" && $0.auxlTargets.isEmpty }) else {
		return nil
	}
	let animation = Animation(color: color)
	animation.hasStill = bytes.find(top, "meta") != nil
	animation.alpha = tracks.first(where: { $0 !== color && $0.av01 && $0.auxlTargets.contains(color.id) && ($0.auxType.isEmpty || alphaKinds.contains($0.auxType)) })
	return color.deltas.isEmpty ? nil : animation
}

func say(_ text: String) {
	FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func clean(_ text: String) -> String {
	return text.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
}

func failure(_ error: Error) -> String {
	if let known = error as? CodecFailure {
		return "failed\t" + clean(known.message)
	}
	return "failed\t" + clean(error.localizedDescription)
}

func isAvif(_ bytes: Bytes) -> Bool {
	if bytes.data.count < 16 || bytes.text(4, 4) != "ftyp" {
		return false
	}
	let size = Int(bytes.u32(0))
	let end = min(bytes.data.count, size >= 16 ? size : 16, 256)
	var at = 8
	while at + 4 <= end {
		if at != 12 {
			let brand = bytes.text(at, 4)
			if brand == "avif" || brand == "avis" {
				return true
			}
		}
		at += 4
	}
	return false
}

func readsAvif() -> Bool {
	let types = CGImageSourceCopyTypeIdentifiers() as? [String] ?? []
	return types.contains("public.avif") || types.contains("public.avis")
}

func seconds(_ value: Double) -> String {
	var text = String(format: "%.6f", value)
	while text.hasSuffix("0") {
		text.removeLast()
	}
	if text.hasSuffix(".") {
		text.removeLast()
	}
	return text
}

func hasAlpha(_ image: CGImage) -> Bool {
	switch image.alphaInfo {
	case .none, .noneSkipFirst, .noneSkipLast:
		return false
	default:
		return true
	}
}

func flatten(_ image: CGImage, _ width: Int, _ height: Int) throws -> CGImage {
	guard let space = CGColorSpace(name: CGColorSpace.sRGB),
		let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
	else {
		throw CodecFailure(message: "The picture could not be prepared.")
	}
	let rect = CGRect(x: 0, y: 0, width: width, height: height)
	context.clear(rect)
	context.interpolationQuality = .high
	context.draw(image, in: rect)
	guard let flat = context.makeImage() else {
		throw CodecFailure(message: "The picture could not be prepared.")
	}
	return flat
}

func writePng(_ image: CGImage, _ target: String) throws {
	let partial = target + ".part"
	let manager = FileManager.default
	try manager.createDirectory(atPath: (target as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
	do {
		guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: partial) as CFURL, "public.png" as CFString, 1, nil) else {
			throw CodecFailure(message: "The PNG file could not be created.")
		}
		CGImageDestinationAddImage(destination, image, nil)
		if !CGImageDestinationFinalize(destination) {
			throw CodecFailure(message: "The PNG file could not be written.")
		}
		if manager.fileExists(atPath: target) {
			try manager.removeItem(atPath: target)
		}
		try manager.moveItem(atPath: partial, toPath: target)
	} catch {
		try? manager.removeItem(atPath: partial)
		throw error
	}
}

func framePath(_ target: String, _ index: Int) -> String {
	let stem = target.lowercased().hasSuffix(".png") ? String(target.dropLast(4)) : target
	return stem + "." + String(index) + ".png"
}

func properties(_ source: CGImageSource, _ index: Int) -> [String: Any] {
	return CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [String: Any] ?? [:]
}

func number(_ value: Any?) -> Double? {
	return (value as? NSNumber)?.doubleValue
}

func frameDelay(_ source: CGImageSource, _ index: Int) -> Double? {
	guard let avis = properties(source, index)["{AVIS}"] as? [String: Any] else {
		return nil
	}
	for key in ["UnclampedDelayTime", "DelayTime"] {
		if let value = number(avis[key]), value > 0 {
			return value
		}
	}
	return nil
}

func decodeFrame(_ source: CGImageSource, _ index: Int) -> CGImage? {
	return CGImageSourceCreateImageAtIndex(source, index, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
}

func convertAnimation(_ source: CGImageSource, _ animation: Animation, _ target: String) throws -> String {
	let count = CGImageSourceGetCount(source)
	if count < 2 && animation.color.deltas.count > 1 && animation.hasStill {
		throw CodecFailure(message: "This version of macOS cannot play AVIF animations.")
	}
	guard let first = decodeFrame(source, 0) else {
		throw CodecFailure(message: "The picture sequence has no pictures in it.")
	}
	let width = first.width
	let height = first.height
	if width <= 0 || height <= 0 {
		return "failed\tThe picture sequence has no size."
	}
	let budget = max(1, min(maxFrames, pixelBudget / max(1, width * height)))
	let limit = min(budget, count)
	let fallback = animation.durations()
	var timings: [String] = []
	for index in 0..<limit {
		let written: Bool = try autoreleasepool {
			guard let frame = index == 0 ? Optional(first) : decodeFrame(source, index) else {
				return false
			}
			try writePng(try flatten(frame, width, height), index == 0 ? target : framePath(target, index))
			return true
		}
		if !written {
			break
		}
		let delay = frameDelay(source, index) ?? (index < fallback.count ? fallback[index] : 0.1)
		timings.append(seconds(delay <= 0.010 ? 0.1 : delay))
	}
	if timings.isEmpty {
		throw CodecFailure(message: "The picture sequence has no pictures in it.")
	}
	let alpha = animation.alpha != nil ? "track" : "none"
	return "ok\t\(width)\t\(height)\t\(alpha)\t\(timings.count)\t\(animation.loops())\t" + timings.joined(separator: ",")
}

func convertStill(_ source: CGImageSource, _ target: String) throws -> String {
	let details = properties(source, 0)
	let storedWidth = Int(number(details[kCGImagePropertyPixelWidth as String]) ?? 0)
	let storedHeight = Int(number(details[kCGImagePropertyPixelHeight as String]) ?? 0)
	var image: CGImage? = nil
	if storedWidth > 0 && storedHeight > 0 {
		let options: [CFString: Any] = [
			kCGImageSourceCreateThumbnailFromImageAlways: true,
			kCGImageSourceCreateThumbnailWithTransform: true,
			kCGImageSourceThumbnailMaxPixelSize: max(storedWidth, storedHeight),
			kCGImageSourceShouldCacheImmediately: true,
		]
		image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
	}
	if image == nil {
		image = decodeFrame(source, 0)
	}
	guard let picture = image else {
		throw CodecFailure(message: "The image has no pictures in it.")
	}
	let width = picture.width
	let height = picture.height
	let alpha = (details["HasAlpha"] as? Bool ?? hasAlpha(picture)) ? "own" : "none"
	try writePng(try flatten(picture, width, height), target)
	return "ok\t\(width)\t\(height)\t\(alpha)\t1\t-1\t"
}

func convert(_ sourcePath: String, _ target: String) -> String {
	guard let data = FileManager.default.contents(atPath: sourcePath) else {
		return "failed\tThe image file could not be read."
	}
	let bytes = Bytes(data: [UInt8](data))
	let avif = isAvif(bytes)
	if avif && !readsAvif() {
		return unsupported
	}
	guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary), CGImageSourceGetType(source) != nil, CGImageSourceGetCount(source) > 0 else {
		return avif ? unsupported : "failed\tThe image could not be read."
	}
	if let animation = readAnimation(bytes) {
		do {
			let answer = try convertAnimation(source, animation, target)
			if answer.hasPrefix("ok\t") || !animation.hasStill {
				return answer
			}
		} catch {
			if !animation.hasStill {
				return failure(error)
			}
		}
	}
	do {
		return try convertStill(source, target)
	} catch {
		return failure(error)
	}
}

say("ready")
while let line = readLine(strippingNewline: true) {
	let parts = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
	let reply: String = autoreleasepool {
		return parts.count < 2 ? "failed\tThe request was malformed." : convert(parts[0], parts[1])
	}
	say(reply)
}
