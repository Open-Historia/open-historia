import CoreGraphics
import Foundation
import ImageIO

let maxFrames = 256
let pixelBudget = 24_000_000
let alphaKinds: Set<String> = ["urn:mpeg:mpegB:cicp:systems:auxiliary:alpha", "urn:mpeg:hevc:2015:auxid:1"]
let unsupported = "missing\tThis version of macOS cannot read AVIF images."
let exifSteps: [Int: [String]] = [2: ["flipX"], 3: ["ccw", "ccw"], 4: ["flipY"], 5: ["ccw", "flipY"], 6: ["ccw", "ccw", "ccw"], 7: ["ccw", "flipX"], 8: ["ccw"]]

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

func renamed(_ data: [UInt8], _ places: [Int], _ name: String) -> [UInt8] {
	var copy = data
	let letters = Array(name.utf8)
	for at in places where at >= 0 && at + 4 <= copy.count && letters.count == 4 {
		for index in 0..<4 {
			copy[at + index] = letters[index]
		}
	}
	return copy
}

struct Items {
	var primary = 0
	var pitmAt = -1
	var pitmWide = false
	var alpha = 0
	var auxlAt: [Int] = []
	var transforms: [Int: [(String, Int)]] = [:]
	var sizes: [Int: (Int, Int)] = [:]
}

func readItems(_ bytes: Bytes) -> Items? {
	let top = bytes.boxes(0, bytes.data.count)
	guard let meta = bytes.find(top, "meta") else {
		return nil
	}
	let children = bytes.boxes(meta.body + 4, meta.end)
	guard let pitm = bytes.find(children, "pitm"), let iprp = bytes.find(children, "iprp") else {
		return nil
	}
	var items = Items()
	items.pitmWide = bytes.u8(pitm.body) != 0
	items.pitmAt = pitm.body + 4
	items.primary = items.pitmWide ? Int(bytes.u32(items.pitmAt)) : bytes.u16(items.pitmAt)
	var candidates: [Int] = []
	if let iref = bytes.find(children, "iref") {
		let refWide = bytes.u8(iref.body) != 0
		let step = refWide ? 4 : 2
		for reference in bytes.boxes(iref.body + 4, iref.end) where reference.type == "auxl" {
			items.auxlAt.append(reference.start + 4)
			var at = reference.body
			let from = refWide ? Int(bytes.u32(at)) : bytes.u16(at)
			at += step
			let count = bytes.u16(at)
			at += 2
			var index = 0
			while index < count && at + step <= reference.end {
				if (refWide ? Int(bytes.u32(at)) : bytes.u16(at)) == items.primary {
					candidates.append(from)
				}
				index += 1
				at += step
			}
		}
	}
	let parts = bytes.boxes(iprp.body, iprp.end)
	guard let ipco = bytes.find(parts, "ipco"), let ipma = bytes.find(parts, "ipma") else {
		return items
	}
	let properties = bytes.boxes(ipco.body, ipco.end)
	let ipmaWide = bytes.u8(ipma.body) != 0
	let bigIndex = (bytes.u8(ipma.body + 3) & 1) != 0
	var cursor = ipma.body + 4
	let entries = Int(bytes.u32(cursor))
	cursor += 4
	var entry = 0
	while entry < entries && cursor < ipma.end {
		let item = ipmaWide ? Int(bytes.u32(cursor)) : bytes.u16(cursor)
		cursor += ipmaWide ? 4 : 2
		let associations = bytes.u8(cursor)
		cursor += 1
		var association = 0
		while association < associations {
			let property = bigIndex ? (bytes.u16(cursor) & 0x7FFF) : (bytes.u8(cursor) & 0x7F)
			cursor += bigIndex ? 2 : 1
			association += 1
			if property < 1 || property > properties.count {
				continue
			}
			let box = properties[property - 1]
			if (box.type == "irot" || box.type == "imir") && box.body < box.end {
				items.transforms[item, default: []].append((box.type, bytes.u8(box.body) & (box.type == "irot" ? 3 : 1)))
			}
			if box.type == "ispe" && box.body + 12 <= box.end {
				items.sizes[item] = (Int(bytes.u32(box.body + 4)), Int(bytes.u32(box.body + 8)))
			}
			if items.alpha != 0 || !candidates.contains(item) || box.type != "auxC" || box.body + 4 >= box.end {
				continue
			}
			if alphaKinds.contains(bytes.cString(box.body + 4, box.end)) {
				items.alpha = item
			}
		}
		entry += 1
	}
	if !items.pitmWide && items.alpha > 0xFFFF {
		items.alpha = 0
	}
	return items
}

func withPrimary(_ data: [UInt8], _ items: Items, _ item: Int) -> [UInt8] {
	var copy = data
	if items.pitmAt < 0 {
		return copy
	}
	let width = items.pitmWide ? 4 : 2
	if items.pitmAt + width > copy.count {
		return copy
	}
	for index in 0..<width {
		copy[items.pitmAt + index] = UInt8((item >> (8 * (width - 1 - index))) & 0xFF)
	}
	return copy
}

final class Track {
	var id = 0
	var handler = ""
	var handlerAt = -1
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
	var auxlAt: [Int] = []
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
			track.auxlAt.append(reference.start + 4)
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
		track.handlerAt = hdlr.body + 8
		track.handler = bytes.text(track.handlerAt, 4)
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

struct Raster {
	var width: Int
	var height: Int
	var pixels: [UInt8]
}

func raster(_ image: CGImage) -> Raster? {
	let width = image.width
	let height = image.height
	guard width > 0, height > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
		let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
	else {
		return nil
	}
	let rect = CGRect(x: 0, y: 0, width: width, height: height)
	context.clear(rect)
	context.interpolationQuality = .none
	context.draw(image, in: rect)
	guard let data = context.data else {
		return nil
	}
	let row = context.bytesPerRow
	let source = data.bindMemory(to: UInt8.self, capacity: row * height)
	var pixels = [UInt8](repeating: 0, count: width * height * 4)
	for y in 0..<height {
		let from = y * row
		let to = y * width * 4
		for x in 0..<(width * 4) {
			pixels[to + x] = source[from + x]
		}
	}
	var at = 0
	while at < pixels.count {
		let alpha = Int(pixels[at + 3])
		if alpha > 0 && alpha < 255 {
			for channel in 0..<3 {
				pixels[at + channel] = UInt8(min(255, (Int(pixels[at + channel]) * 255 + alpha / 2) / alpha))
			}
		}
		at += 4
	}
	return Raster(width: width, height: height, pixels: pixels)
}

func rotatedCounterClockwise(_ picture: Raster) -> Raster {
	let width = picture.width
	let height = picture.height
	var out = [UInt8](repeating: 0, count: picture.pixels.count)
	for y in 0..<width {
		for x in 0..<height {
			let from = (x * width + (width - 1 - y)) * 4
			let to = (y * height + x) * 4
			for channel in 0..<4 {
				out[to + channel] = picture.pixels[from + channel]
			}
		}
	}
	return Raster(width: height, height: width, pixels: out)
}

func flipped(_ picture: Raster, vertically: Bool) -> Raster {
	let width = picture.width
	let height = picture.height
	var out = [UInt8](repeating: 0, count: picture.pixels.count)
	for y in 0..<height {
		for x in 0..<width {
			let from = vertically ? ((height - 1 - y) * width + x) * 4 : (y * width + (width - 1 - x)) * 4
			let to = (y * width + x) * 4
			for channel in 0..<4 {
				out[to + channel] = picture.pixels[from + channel]
			}
		}
	}
	return Raster(width: width, height: height, pixels: out)
}

func oriented(_ picture: Raster, _ steps: [String]) -> Raster {
	var current = picture
	for step in steps {
		if step == "ccw" {
			current = rotatedCounterClockwise(current)
		} else {
			current = flipped(current, vertically: step == "flipY")
		}
	}
	return current
}

func orientationSteps(_ items: Items?, _ source: CGImageSource, _ width: Int, _ height: Int) -> [String] {
	if let items = items, let list = items.transforms[items.primary], !list.isEmpty {
		var steps: [String] = []
		for (kind, value) in list {
			if kind == "irot" {
				steps += Array(repeating: "ccw", count: value)
			} else {
				steps.append(value == 0 ? "flipY" : "flipX")
			}
		}
		let quarter = steps.filter({ $0 == "ccw" }).count % 2 == 1
		if quarter, let size = items.sizes[items.primary], size.0 != size.1, width == size.1, height == size.0 {
			return []
		}
		return steps
	}
	let code = Int(number(properties(source, 0)[kCGImagePropertyOrientation as String]) ?? 1)
	return exifSteps[code] ?? []
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

func makeSource(_ data: [UInt8]) -> CGImageSource? {
	guard let source = CGImageSourceCreateWithData(Data(data) as CFData, [kCGImageSourceShouldCache: false] as CFDictionary), CGImageSourceGetType(source) != nil, CGImageSourceGetCount(source) > 0 else {
		return nil
	}
	return source
}

func writePng(_ picture: Raster, _ target: String) throws {
	guard let space = CGColorSpace(name: CGColorSpace.sRGB), let provider = CGDataProvider(data: Data(picture.pixels) as CFData),
		let image = CGImage(width: picture.width, height: picture.height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: picture.width * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
	else {
		throw CodecFailure(message: "The picture could not be prepared.")
	}
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

func withMask(_ picture: Raster, _ mask: Raster) -> Raster? {
	if mask.width != picture.width || mask.height != picture.height {
		return nil
	}
	var out = picture
	var at = 0
	while at < out.pixels.count {
		out.pixels[at + 3] = mask.pixels[at + 1]
		at += 4
	}
	return out
}

func trackCopies(_ bytes: Bytes, _ animation: Animation) -> (color: [UInt8], mask: [UInt8])? {
	guard let alpha = animation.alpha, alpha.handlerAt >= 0, animation.color.handlerAt >= 0 else {
		return nil
	}
	let color = renamed(renamed(bytes.data, [alpha.handlerAt], "xxxx"), alpha.auxlAt, "xuxl")
	let mask = renamed(renamed(renamed(bytes.data, [animation.color.handlerAt], "xxxx"), [alpha.handlerAt], "pict"), alpha.auxlAt, "xuxl")
	return (color, mask)
}

func convertAnimation(_ source: CGImageSource, _ bytes: Bytes, _ animation: Animation, _ target: String) throws -> String {
	let count = CGImageSourceGetCount(source)
	if count < 2 && animation.color.deltas.count > 1 && animation.hasStill {
		throw CodecFailure(message: "This version of macOS cannot play AVIF animations.")
	}
	var frames = source
	var masks: CGImageSource? = nil
	if let copies = trackCopies(bytes, animation), let colorOnly = makeSource(copies.color), let maskOnly = makeSource(copies.mask), CGImageSourceGetCount(colorOnly) == count, CGImageSourceGetCount(maskOnly) == count {
		frames = colorOnly
		masks = maskOnly
	}
	guard let firstImage = decodeFrame(frames, 0), let first = raster(firstImage) else {
		throw CodecFailure(message: "The picture sequence has no pictures in it.")
	}
	let width = first.width
	let height = first.height
	let budget = max(1, min(maxFrames, pixelBudget / max(1, width * height)))
	let limit = min(budget, count)
	let fallback = animation.durations()
	var timings: [String] = []
	var alphaState = animation.alpha != nil ? "track" : "none"
	for index in 0..<limit {
		let written: Bool = try autoreleasepool {
			var picture: Raster
			if index == 0 {
				picture = first
			} else {
				guard let image = decodeFrame(frames, index), let decoded = raster(image) else {
					return false
				}
				picture = decoded
			}
			if let masks = masks {
				if let maskImage = decodeFrame(masks, index), let mask = raster(maskImage), let applied = withMask(picture, mask) {
					picture = applied
				} else {
					alphaState = "unreadable"
				}
			}
			try writePng(picture, index == 0 ? target : framePath(target, index))
			return true
		}
		if !written {
			break
		}
		let delay = frameDelay(source, index) ?? (index < fallback.count ? fallback[index] : 0.1)
		timings.append(seconds(delay <= 0.010 ? 0.1 : delay))
	}
	return "ok\t\(width)\t\(height)\t\(alphaState)\t\(timings.count)\t\(animation.loops())\t" + timings.joined(separator: ",")
}

func planeStill(_ bytes: Bytes, _ items: Items, _ target: String) throws -> String? {
	let colorData = renamed(bytes.data, items.auxlAt, "xuxl")
	guard let colorSource = makeSource(colorData), let colorImage = decodeFrame(colorSource, 0), var picture = raster(colorImage) else {
		return nil
	}
	var alpha = "unreadable"
	if let maskSource = makeSource(withPrimary(colorData, items, items.alpha)), let maskImage = decodeFrame(maskSource, 0), let mask = raster(maskImage) {
		if let applied = withMask(picture, mask) {
			picture = applied
			alpha = "plane"
		} else {
			alpha = "none"
		}
	}
	picture = oriented(picture, orientationSteps(items, colorSource, picture.width, picture.height))
	try writePng(picture, target)
	return "ok\t\(picture.width)\t\(picture.height)\t\(alpha)\t1\t-1\t"
}

func convertStill(_ source: CGImageSource, _ bytes: Bytes, _ target: String) throws -> String {
	let items = readItems(bytes)
	if let items = items, items.alpha != 0, let answer = try planeStill(bytes, items, target) {
		return answer
	}
	guard let image = decodeFrame(source, 0), let decoded = raster(image) else {
		throw CodecFailure(message: "The image has no pictures in it.")
	}
	let alpha = (properties(source, 0)["HasAlpha"] as? Bool ?? hasAlpha(image)) ? "own" : "none"
	let picture = oriented(decoded, orientationSteps(items, source, decoded.width, decoded.height))
	try writePng(picture, target)
	return "ok\t\(picture.width)\t\(picture.height)\t\(alpha)\t1\t-1\t"
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
	guard let source = makeSource(bytes.data) else {
		return avif ? unsupported : "failed\tThe image could not be read."
	}
	if let animation = readAnimation(bytes) {
		do {
			let answer = try convertAnimation(source, bytes, animation, target)
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
		return try convertStill(source, bytes, target)
	} catch {
		return failure(error)
	}
}

func summary(_ picture: Raster) -> String {
	var clear = 0
	var solid = 0
	var sums = [0, 0, 0, 0]
	var at = 0
	while at < picture.pixels.count {
		for channel in 0..<4 {
			sums[channel] += Int(picture.pixels[at + channel])
		}
		if picture.pixels[at + 3] == 0 {
			clear += 1
		} else if picture.pixels[at + 3] == 255 {
			solid += 1
		}
		at += 4
	}
	let count = max(1, picture.pixels.count / 4)
	var corners: [String] = []
	for (fx, fy) in [(1, 1), (5, 1), (3, 3), (1, 5), (5, 5)] {
		let x = min(picture.width - 1, picture.width * fx / 6)
		let y = min(picture.height - 1, picture.height * fy / 6)
		let spot = (y * picture.width + x) * 4
		corners.append(picture.pixels[spot..<(spot + 4)].map { String($0) }.joined(separator: ","))
	}
	return "\(picture.width)x\(picture.height) clear \(clear) solid \(solid) mean \(sums.map { String($0 / count) }.joined(separator: ",")) spots \(corners.joined(separator: " "))"
}

func describe(_ label: String, _ source: CGImageSource?) -> String {
	guard let source = source else {
		return "\(label): unreadable"
	}
	let details = properties(source, 0)
	var parts = ["\(label): \(CGImageSourceGetType(source).map { $0 as String } ?? "-") count \(CGImageSourceGetCount(source))"]
	parts.append("orientation \(details["Orientation"].map { "\($0)" } ?? "-") hasAlpha \(details["HasAlpha"].map { "\($0)" } ?? "-") stored \(details["PixelWidth"].map { "\($0)" } ?? "-")x\(details["PixelHeight"].map { "\($0)" } ?? "-")")
	if let image = decodeFrame(source, 0) {
		let spaceName: String = image.colorSpace.flatMap { $0.name }.map { $0 as String } ?? "-"
		parts.append("image \(image.width)x\(image.height) bpc \(image.bitsPerComponent) bpp \(image.bitsPerPixel) alphaInfo \(image.alphaInfo.rawValue) space \(spaceName)")
		if let picture = raster(image) {
			parts.append(summary(picture))
		}
	} else {
		parts.append("no image")
	}
	let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 4096]
	if let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary), let picture = raster(thumbnail) {
		parts.append("thumbnail " + summary(picture))
	}
	return parts.joined(separator: "; ")
}

func probe(_ sourcePath: String) -> String {
	guard let data = FileManager.default.contents(atPath: sourcePath) else {
		return "unreadable file"
	}
	let bytes = Bytes(data: [UInt8](data))
	var lines = [describe("file", makeSource(bytes.data))]
	if let items = readItems(bytes) {
		lines.append("items primary \(items.primary) alpha \(items.alpha) transforms \(items.transforms[items.primary].map { "\($0)" } ?? "-") size \(items.sizes[items.primary].map { "\($0)" } ?? "-")")
		if items.alpha != 0 {
			let colorData = renamed(bytes.data, items.auxlAt, "xuxl")
			lines.append(describe("colour item", makeSource(colorData)))
			lines.append(describe("alpha item", makeSource(withPrimary(colorData, items, items.alpha))))
		}
	}
	if let animation = readAnimation(bytes), let copies = trackCopies(bytes, animation) {
		lines.append(describe("colour track", makeSource(copies.color)))
		lines.append(describe("alpha track", makeSource(copies.mask)))
	}
	return lines.joined(separator: " || ")
}

say("ready")
while let line = readLine(strippingNewline: true) {
	let parts = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
	let reply: String = autoreleasepool {
		if parts.count >= 2 && parts[0] == "probe" {
			return "probe\t" + clean(probe(parts[1]))
		}
		return parts.count < 2 ? "failed\tThe request was malformed." : convert(parts[0], parts[1])
	}
	say(reply)
}
