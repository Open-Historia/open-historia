extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const GROUND := Color("#141416")
const STAGE := Color("#18191c")
const RAISED := Color("#232327")
const INK := Color("#e7e7ea")
const SOFT := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.72)
const FAINT := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.34)
const LINE := Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.12)
const ACCENT := Color("#2bc1f3")
const FACE := "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif"
const AMBER := Color("#f2b33d")
const CORAL := Color("#e8664f")
const GREEN := Color("#5cc27a")
const IVORY := Color("#e9e2cf")
const ROUND := [AMBER, CORAL, GREEN, IVORY]
const HELD_BY := {"table": AMBER, "ledger": CORAL, "secrets": GREEN, "envoys": IVORY, "fronts": AMBER}

const TABLE := Color("#26272b")
const SEA := Color("#1d2125")
const LAND := Color("#32343a")
const CHAIR := Color("#2e2f34")
const FRAME := Color("#2b2c31")
const SCREEN := Color("#0f1012")
const FOG := Color("#393b41")
const FOG_NEAR := Color("#3e4046")
const LAND_CLEAR := Color("#44464c")
const PAPER := Color("#dcd8cc")
const PAPER_BACK := Color("#bdb8ab")
const PAPER_INK := Color("#2a2b30")
const GRASS := Color("#25272b")
const SEAL_RIM := Color("#9c7426")

const H := 220.0
const RISE := "cubic-bezier(0.2, 0.7, 0.2, 1)"
const PULSE := "cubic-bezier(0.4, 0, 0.6, 1)"
const SWING := "cubic-bezier(0.45, 0, 0.55, 1)"
const TICKED := "M-4 0 L-1 3 L5 -4"

const MOTIONS := {
	"ohWorldsRelay": {
		"tx": [[0.0, 0.0], [0.19, 0.0], [0.225, 56.0], [0.25, 112.0], [0.44, 112.0], [0.475, 168.0], [0.5, 224.0], [0.69, 224.0], [0.725, 280.0], [0.75, 336.0], [0.94, 336.0], [0.97, 168.0], [1.0, 0.0]],
		"ty": [[0.0, 0.0], [0.19, 0.0], [0.225, -16.0], [0.25, 0.0], [0.44, 0.0], [0.475, -16.0], [0.5, 0.0], [0.69, 0.0], [0.725, -16.0], [0.75, 0.0], [0.94, 0.0], [0.97, -36.0], [1.0, 0.0]],
	},
	"ohWorldsTurn": {"opacity": [[0.0, 1.0], [0.21, 1.0], [0.25, 0.0], [0.96, 0.0], [1.0, 1.0]]},
	"ohWorldsOpen": {"s": [[0.0, 0.0], [1.0, 1.0]]},
	"ohWorldsDrift": {"tx": [[0.0, 0.0], [0.5, "drift"], [1.0, 0.0]]},
	"ohWorldsFlip": {"sy": [[0.0, -1.0], [1.0, 1.0]]},
	"ohWorldsSlide": {"ty": [[0.0, "slide"], [1.0, 0.0]]},
	"ohWorldsSortie": {"opacity": [[0.0, 0.0], [0.1, 1.0], [0.74, 1.0], [0.84, 0.0], [1.0, 0.0]], "tx": [[0.0, 0.0], [0.84, "run"], [1.0, "run"]]},
	"ohWorldsHit": {"opacity": [[0.0, 0.0], [0.76, 0.0], [0.79, 1.0], [0.97, 0.0], [1.0, 0.0]], "s": [[0.0, 0.3], [0.76, 0.3], [0.79, 0.5], [0.97, 2.2], [1.0, 2.2]]},
}
const TONES := {"join": [659.25, 987.77], "leave": [987.77, 659.25], "open": [587.33, 880.0], "sign": [523.25, 783.99, 1046.5], "strike": [146.83, 110.0]}

const LANDS := {
	"a": "299,83 319,78 343,76 348,105 291,110 286,97",
	"b": "343,76 369,71 396,80 393,112 348,105",
	"c": "396,80 422,73 446,75 453,107 393,112",
	"d": "446,75 475,76 503,85 516,98 512,112 453,107",
	"e": "291,110 348,105 345,144 325,147 304,140 295,125",
	"f": "348,105 393,112 400,139 372,145 345,144",
	"g": "393,112 453,107 448,145 424,149 400,139",
	"h": "453,107 512,112 509,127 498,137 474,144 448,145",
}
const CAPITALS := {"a": [316.0, 93.0], "c": [423.0, 92.0], "d": [482.0, 94.0], "e": [318.0, 127.0], "h": [482.0, 127.0]}
const SEATS := [
	{"x": 300.0, "y": 26.0, "colour": AMBER, "land": "a", "away": false},
	{"x": 400.0, "y": 26.0, "colour": CORAL, "land": "c", "away": false},
	{"x": 500.0, "y": 26.0, "colour": GREEN, "land": "d", "away": false},
	{"x": 340.0, "y": 194.0, "colour": IVORY, "land": "e", "away": true},
]
const FREE_SEAT := {"x": 460.0, "y": 194.0, "land": "h", "away": false}

const RELAY_MS := 8000.0
const DEVICES := [
	{"x": 232.0, "colour": AMBER, "kind": "monitor", "frame": [-36.0, 120.0, 72.0, 50.0, 4.0], "screen": [-32.0, 124.0, 64.0, 40.0, 2.0]},
	{"x": 344.0, "colour": CORAL, "kind": "laptop", "frame": [-32.0, 132.0, 64.0, 46.0, 4.0], "screen": [-28.0, 136.0, 56.0, 38.0, 2.0]},
	{"x": 456.0, "colour": GREEN, "kind": "tablet", "frame": [-26.0, 122.0, 52.0, 68.0, 7.0], "screen": [-22.0, 128.0, 44.0, 56.0, 3.0]},
	{"x": 568.0, "colour": IVORY, "kind": "phone", "frame": [-16.0, 132.0, 32.0, 58.0, 6.0], "screen": [-13.0, 138.0, 26.0, 44.0, 3.0]},
]

const BOARD := Rect2(192, 22, 416, 176)
const YOUR_LAND := "206,38 296,30 330,58 322,112 284,140 238,186 208,184 200,120"
const THEIR_LANDS := [
	[CORAL, "296,30 596,28 602,112 528,124 440,100 322,112 330,58"],
	[GREEN, "322,112 440,100 528,124 602,112 598,184 520,190 470,174 400,184 330,178 300,190 238,186 284,140"],
]
const STANDING := [
	{"x": 476.0, "y": 62.0, "colour": CORAL, "shape": "fort"},
	{"x": 380.0, "y": 80.0, "colour": CORAL, "shape": "army"},
	{"x": 440.0, "y": 150.0, "colour": GREEN, "shape": "works"},
	{"x": 540.0, "y": 156.0, "colour": GREEN, "shape": "army"},
]

const SIGNED_FIRST := "M334 174 c4 -10 9 -12 10 -3 c1 6 5 6 8 -2 c3 -8 6 -8 7 0 c1 6 6 6 9 -4 c2 -5 6 -3 8 2 c2 4 6 4 10 -2"
const SIGNED_SECOND := "M412 174 c3 -12 10 -14 11 -4 c1 7 5 7 9 -1 c3 -7 6 -6 6 1 c0 6 6 5 9 -5 c3 -6 7 -2 8 3 c2 4 7 2 9 -3"

const FRONT := [[400.0, 0.0], [392.0, 30.0], [408.0, 58.0], [412.0, 88.0], [398.0, 116.0], [388.0, 146.0], [402.0, 176.0], [406.0, 220.0]]
const SORTIE_MS := 5200.0
const CRATERS := [[AMBER, 436.0, 36.0], [AMBER, 446.0, 112.0], [AMBER, 428.0, 160.0], [CORAL, 372.0, 70.0], [CORAL, 366.0, 128.0], [CORAL, 378.0, 192.0]]
const PLANE := "M-11 -1.8 L7 -1.8 L11 0 L7 1.8 L-11 1.8 Z M-2 -1.8 L2 -1.8 L-1 -11 L-4 -11 Z M-2 1.8 L2 1.8 L-1 11 L-4 11 Z M-11 -1.5 L-8 -1.5 L-10 -5.5 L-12 -5.5 Z M-11 1.5 L-8 1.5 L-10 5.5 L-12 5.5 Z"


static func seat_of(banner: Dictionary) -> Color:
	return HELD_BY.get(str(banner.get("scene", "")), AMBER)


static func chrome(banner: Dictionary) -> Dictionary:
	var seat := seat_of(banner)
	return {
		"button": {"bg": seat, "border": seat, "radius": 8.0, "ink": GROUND, "font": FACE, "weight": 800, "spacing": 0.02},
		"arrow": {"bg": RAISED, "border": Kit.ink(0.22), "radius": 8.0, "ink": seat},
		"dot": {"on": seat, "off": Kit.ink(0.24), "radius": 999.0},
		"skip": {"ink": SOFT, "font": FACE, "spacing": 0.02},
	}


class Kit extends RefCounted:
	static func px(value: float) -> float:
		return UpdateKit.px(value)

	static func ink(alpha: float) -> Color:
		return Color(INK.r, INK.g, INK.b, alpha)

	static func points(text: String) -> PackedVector2Array:
		var out := PackedVector2Array()
		for pair in text.split(" ", false):
			var parts := pair.split(",")
			out.append(Vector2(float(parts[0]), float(parts[1])))
		return out

	static func polygon_path(text: String) -> String:
		var spots := Kit.points(text)
		var data := ""
		for at in range(spots.size()):
			data += ("M" if at == 0 else " L") + "%s %s" % [spots[at].x, spots[at].y]
		return data + " Z"

	static func ring_points(centre: Vector2, radius: float) -> PackedVector2Array:
		var out := PackedVector2Array()
		for step in range(40):
			var angle := TAU * float(step) / 40.0
			out.append(centre + Vector2(cos(angle), sin(angle)) * radius)
		return out

	static func front_at(y: float) -> float:
		for at in range(1, FRONT.size()):
			var x0: float = FRONT[at - 1][0]
			var y0: float = FRONT[at - 1][1]
			var x1: float = FRONT[at][0]
			var y1: float = FRONT[at][1]
			if y <= y1:
				return x0 + (x1 - x0) * (y - y0) / (y1 - y0)
		return float(FRONT[FRONT.size() - 1][0])

	static func with(base: Dictionary, extra: Dictionary) -> Dictionary:
		var merged := base.duplicate()
		for key in extra.keys():
			merged[key] = extra[key]
		return merged

	static func once(name: String, duration: float, delay: float, timing := RISE, vars := {}) -> Dictionary:
		return {"anims": [Scene.motion(name, duration, delay, timing, vars)]}

	static func always(name: String, duration: float, delay: float, timing := "linear", vars := {}) -> Dictionary:
		return {"anims": [Scene.forever(name, duration, delay, timing, vars)]}

	static func chime_stream(tones: Array) -> AudioStreamWAV:
		var rate := 44100
		var length := 0.09 * float(tones.size() - 1) + 0.75
		var count := int(length * float(rate))
		var data := PackedByteArray()
		data.resize(count * 2)
		var ratio := 0.0001 / 0.12
		for index in range(count):
			var t := float(index) / float(rate)
			var sample := 0.0
			for at in range(tones.size()):
				var frequency: float = tones[at]
				var local := t - float(at) * 0.09
				if local < 0.0 or local > 0.75:
					continue
				var level := 0.0001
				if local < 0.01:
					level = 0.0001 + (0.12 - 0.0001) * (local / 0.01)
				elif local < 0.7:
					level = 0.12 * pow(ratio, (local - 0.01) / 0.69)
				var wave := sin(TAU * frequency * local)
				if frequency < 200.0:
					var phase := fmod(frequency * local + 0.25, 1.0)
					wave = 1.0 - 4.0 * absf(phase - 0.5)
				sample += wave * level
			data.encode_s16(index * 2, int(clampf(sample, -1.0, 1.0) * 32767.0))
		var stream := AudioStreamWAV.new()
		stream.format = AudioStreamWAV.FORMAT_16_BITS
		stream.mix_rate = rate
		stream.stereo = false
		stream.data = data
		return stream


class Touch extends Button:
	var colour := INK
	var clear := false
	var dashed := false
	var glyph := ""
	var across := 33.6

	func _init() -> void:
		focus_mode = Control.FOCUS_NONE
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		flat = true
		text = ""
		var empty := StyleBoxEmpty.new()
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			add_theme_stylebox_override(state, empty)

	func place(anchor: Vector2) -> void:
		anchor_left = anchor.x
		anchor_right = anchor.x
		anchor_top = anchor.y
		anchor_bottom = anchor.y
		offset_left = -across * 0.5
		offset_right = across * 0.5
		offset_top = -across * 0.5
		offset_bottom = across * 0.5
		custom_minimum_size = Vector2(across, across)

	func look(tint: Color, is_clear: bool, is_dashed: bool, icon: String) -> void:
		colour = tint
		clear = is_clear
		dashed = is_dashed
		glyph = icon
		queue_redraw()

	func _draw() -> void:
		var centre := size * 0.5
		var radius := minf(size.x, size.y) * 0.5
		if not clear:
			draw_circle(centre, radius, Color(20 / 255.0, 20 / 255.0, 22 / 255.0, 0.78), true, -1.0, true)
		var edge := radius - 0.75
		if dashed:
			var round_length := TAU * edge
			var count := maxi(4, roundi(round_length / 9.0))
			var step := TAU / float(count)
			for at in range(count):
				draw_arc(centre, edge, float(at) * step, float(at) * step + step * 0.5, 6, colour, 1.5, true)
		else:
			draw_arc(centre, edge, 0.0, TAU, 64, colour, 1.5, true)
		match glyph:
			"plus":
				var unit := 14.0 / 14.0
				var corner := centre - Vector2(7, 7) * unit
				_stroke([corner + Vector2(7, 2) * unit, corner + Vector2(7, 12) * unit], 2.0)
				_stroke([corner + Vector2(2, 7) * unit, corner + Vector2(12, 7) * unit], 2.0)
			"pen":
				var unit := 15.0 / 16.0
				var corner := centre - Vector2(7.5, 7.5)
				var body: Array = [Vector2(3, 13), Vector2(4, 9.5), Vector2(11, 2.5), Vector2(13.5, 5), Vector2(6.5, 12), Vector2(3, 13)]
				var moved: Array = []
				for spot in body:
					moved.append(corner + (spot as Vector2) * unit)
				_stroke(moved, 1.5)
				_stroke([corner + Vector2(9.5, 4) * unit, corner + Vector2(12, 6.5) * unit], 1.5)
			"aim":
				var corner := centre - Vector2(8, 8)
				draw_arc(corner + Vector2(8, 8), 4.5, 0.0, TAU, 32, colour, 1.5, true)
				_stroke([corner + Vector2(8, 0.5), corner + Vector2(8, 4.5)], 1.5)
				_stroke([corner + Vector2(8, 11.5), corner + Vector2(8, 15.5)], 1.5)
				_stroke([corner + Vector2(0.5, 8), corner + Vector2(4.5, 8)], 1.5)
				_stroke([corner + Vector2(11.5, 8), corner + Vector2(15.5, 8)], 1.5)

	func _stroke(spots: Array, thickness: float) -> void:
		var line_points := PackedVector2Array()
		for spot in spots:
			line_points.append(spot as Vector2)
		draw_polyline(line_points, colour, thickness, true)
		for spot in [line_points[0], line_points[line_points.size() - 1]]:
			draw_circle(spot as Vector2, thickness * 0.5, colour, true, -1.0, true)
		for index in range(1, line_points.size() - 1):
			draw_circle(line_points[index], thickness * 0.5, colour, true, -1.0, true)


class Stage extends Control:
	var still := false
	var narrow := false
	var sound := false
	var kind := "table"
	var view_x := 0.0
	var view_w := 800.0
	var scene: Scene
	var touch: Touch
	var drives: Array[Dictionary] = []
	var holders := {}
	var joined := false
	var open := false
	var signs := 0
	var strikes := 0
	var flights := {}

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		clip_contents = true
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func setup(scene_name: String, is_still: bool, is_narrow: bool, with_sound: bool) -> void:
		kind = scene_name if ["table", "ledger", "secrets", "envoys", "fronts"].has(scene_name) else "table"
		still = is_still
		narrow = is_narrow
		sound = with_sound
		view_x = 170.0 if narrow else 0.0
		view_w = 460.0 if narrow else 800.0
		scene = Scene.new(Rect2(view_x, 0, view_w, H), "slice", still)
		scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		scene.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(scene)
		scene.rect(scene.root, 0, 0, 800, H, {"fill": STAGE})
		match kind:
			"table":
				_table()
				_touch(FREE_SEAT["x"], FREE_SEAT["y"], "Join")
			"ledger":
				_ledger()
			"secrets":
				_secrets()
				_touch(258.0, 158.0, "Open")
			"envoys":
				_envoys()
				_touch(500.0, 170.0, "Sign")
			"fronts":
				_fronts()
				_touch(400.0, 24.0, "Strike")
		_restyle_touch()
		_apply_drives()

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED:
			var want := size.x * H / view_w
			if absf(custom_minimum_size.y - want) > 0.5:
				custom_minimum_size = Vector2(0.0, want)

	func _process(_delta: float) -> void:
		if not drives.is_empty() and is_visible_in_tree():
			_apply_drives()

	func _touch(x: float, y: float, label: String) -> void:
		touch = Touch.new()
		touch.name = label
		touch.across = Kit.px(2.75) if UI.phone() else Kit.px(2.1)
		touch.place(Vector2((x - view_x) / view_w, y / H))
		touch.pressed.connect(_on_touch)
		add_child(touch)

	func _restyle_touch() -> void:
		if touch == null:
			return
		match kind:
			"table":
				touch.look(ACCENT if joined else INK, joined, not joined, "" if joined else "plus")
			"secrets":
				touch.look(AMBER, true, not open, "")
			"envoys":
				touch.look(CORAL, false, false, "pen")
			"fronts":
				touch.look(INK, false, false, "aim")

	func _on_touch() -> void:
		match kind:
			"table":
				_chime("leave" if joined else "join")
				joined = not joined
				_fill_joined()
			"secrets":
				_chime("open")
				open = not open
				_fill_letter()
			"envoys":
				_chime("sign")
				signs += 1
				_fill_signed()
			"fronts":
				_chime("strike")
				strikes += 1
				_fill_strikes()
		_restyle_touch()
		_apply_drives()
		scene.redraw()

	func _chime(which: String) -> void:
		if not sound:
			return
		var player := AudioStreamPlayer.new()
		player.stream = Kit.chime_stream(TONES[which])
		add_child(player)
		player.finished.connect(player.queue_free)
		player.play()

	func drive(shape: Scene.Shape, motion_name: String, duration: float, delay: float, timing: String, infinite: bool, vars := {}, owner_key := "", hole := Vector2.INF) -> void:
		var frames: Dictionary = MOTIONS[motion_name]
		var tracks := {}
		for key in frames.keys():
			var stops: Array = []
			for stop in frames[key]:
				var raw: Variant = stop[1]
				var value := 0.0
				if raw is String:
					value = float(vars.get(str(raw), 0.0))
				else:
					value = float(raw)
				stops.append([float(stop[0]), value])
			tracks[key] = stops
		drives.append({"shape": shape, "tracks": tracks, "duration": maxf(1.0, duration), "delay": delay, "curve": CubicBezier.named(timing), "infinite": infinite, "born": float(Time.get_ticks_msec()), "owner": owner_key, "hole": hole})

	func _apply_drives() -> void:
		var now := float(Time.get_ticks_msec())
		for entry in drives:
			var elapsed: float = now - float(entry["born"]) - float(entry["delay"])
			var duration: float = entry["duration"]
			var progress := 0.0
			if elapsed < 0.0:
				progress = 0.0
			elif bool(entry["infinite"]):
				progress = fmod(elapsed, duration) / duration
			else:
				progress = minf(1.0, elapsed / duration)
			var curve: CubicBezier = entry["curve"]
			var values := {}
			var tracks: Dictionary = entry["tracks"]
			for key in tracks.keys():
				var stops: Array = tracks[key]
				var value: float = float(stops[0][1])
				if progress >= float(stops[stops.size() - 1][0]):
					value = float(stops[stops.size() - 1][1])
				elif progress > float(stops[0][0]):
					for index in range(stops.size() - 1):
						var a: Array = stops[index]
						var b: Array = stops[index + 1]
						if progress <= float(b[0]):
							var span := maxf(1e-6, float(b[0]) - float(a[0]))
							value = lerpf(float(a[1]), float(b[1]), curve.at((progress - float(a[0])) / span))
							break
				values[key] = value
			var shape: Scene.Shape = entry["shape"]
			var hole: Vector2 = entry["hole"]
			if hole != Vector2.INF:
				var reach := 21.0 * float(values.get("s", 1.0))
				shape.visible = reach > 0.05
				shape.clip = Kit.ring_points(hole, maxf(0.05, reach))
				continue
			if values.has("tx") or values.has("ty"):
				shape.offset = Vector2(float(values.get("tx", 0.0)), float(values.get("ty", 0.0)))
				shape.uses_css = true
			if values.has("s"):
				var zoom_now: float = values["s"]
				shape.zoom = zoom_now
				shape.visible = zoom_now > 0.001
				shape.uses_css = true
			if values.has("sy"):
				shape.css = [["scale", 1.0, float(values["sy"])]]
				shape.uses_css = true
			if values.has("opacity"):
				shape.opacity = float(values["opacity"])

	func _drop_drives(owner_key: String) -> void:
		var kept: Array[Dictionary] = []
		for entry in drives:
			if str(entry["owner"]) != owner_key:
				kept.append(entry)
		drives = kept

	func _holder(key: String) -> Scene.Shape:
		var shape := scene.group(scene.root)
		holders[key] = shape
		return shape

	func _clear(key: String) -> Scene.Shape:
		var shape: Scene.Shape = holders[key]
		shape.children.clear()
		shape.box_ready = false
		_drop_drives(key)
		return shape

	func drawn(length: float, duration: float, delay: float) -> Dictionary:
		if still:
			return {}
		return {"dash": [length], "anims": [Scene.motion("ohUpdDraw", duration, delay, "cubic-bezier(0.45, 0, 0.2, 1)", {"length": length})]}

	func card(x: float, delay := 500.0) -> Scene.Shape:
		var g := scene.group(scene.root, Kit.once("ohUpdFade", 700.0, delay))
		scene.rect(g, x, 35, 140, 150, {"fill": RAISED, "rx": 8, "stroke": LINE})
		return g

	func at_point(parent: Scene.Shape, x: float, y: float, extra := {}) -> Scene.Shape:
		return scene.group(parent, Kit.with({"transform": Transform2D(0.0, Vector2(x, y))}, extra))

	func player(parent: Scene.Shape, colour: Color, up: bool) -> void:
		var s := scene
		s.rect(parent, -20, 9.0 if up else -19.0, 40, 10, {"fill": CHAIR, "rx": 4, "stroke": LINE})
		s.ellipse(parent, 0, 0, 15, 8, {"fill": colour, "opacity": 0.75})
		s.circle(parent, 0, -1.0 if up else 1.0, 6.5, {"fill": colour, "stroke": STAGE, "width": 2.0})

	func claim(parent: Scene.Shape, seat: Dictionary, colour: Color, delay: float) -> void:
		var s := scene
		var capital: Array = CAPITALS[seat["land"]]
		var cx: float = capital[0]
		var cy: float = capital[1]
		var sx: float = seat["x"]
		var sy: float = seat["y"]
		var up := sy > 110.0
		var away: bool = seat.get("away", false)
		s.path(parent, Kit.polygon_path(LANDS[seat["land"]]), Kit.with({"fill": colour, "opacity": 0.55 if away else 0.85, "stroke": SEA, "width": 1.5}, Kit.once("ohUpdFade", 600.0, delay + 400.0)))
		s.line(parent, sx, sy + (-12.0 if up else 12.0), cx, cy, Kit.with({"stroke": colour, "cap": "round", "stroke_opacity": 0.45 if away else 0.8, "width": 1.5}, drawn(90.0, 700.0, delay)))
		var spot := at_point(parent, cx, cy)
		s.circle(spot, 0, 0, 2.8, Kit.with({"fill": colour, "stroke": SEA, "width": 1.0}, Kit.once("ohUpdFade", 400.0, delay + 600.0)))

	func _table() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		var dot := Kit.ink(0.07)
		for row in range(11):
			for column in range(40):
				s.circle(root, 10.0 + 20.0 * column, 10.0 + 20.0 * row, 0.9, {"fill": dot})
		s.rect(root, 186, 44, 428, 132, {"fill": TABLE, "rx": 66, "stroke": Kit.ink(0.16), "width": 1.5})
		s.rect(root, 193, 51, 414, 118, {"fill": null, "rx": 59, "stroke": Color(0, 0, 0, 0.35), "width": 2.0})
		var chart := s.group(root, Kit.once("ohUpdFade", 700.0, 200.0))
		s.rect(chart, 262, 62, 276, 96, {"fill": SEA, "rx": 3, "stroke": ACCENT, "stroke_opacity": 0.5, "width": 1.2})
		var grid := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.1)
		for x in [308.0, 354.0, 400.0, 446.0, 492.0]:
			s.line(chart, x, 62, x, 158, {"stroke": grid})
		for y in [86.0, 110.0, 134.0]:
			s.line(chart, 262, y, 538, y, {"stroke": grid})
		for id in LANDS.keys():
			s.path(chart, Kit.polygon_path(LANDS[id]), {"fill": LAND, "stroke": SEA, "join": "round", "width": 1.5})
		for at in range(SEATS.size()):
			claim(root, SEATS[at], SEATS[at]["colour"], 700.0 + at * 280.0)
		_holder("claim")
		for at in range(SEATS.size()):
			var seat: Dictionary = SEATS[at]
			var spot := at_point(root, seat["x"], seat["y"])
			var shown := s.group(spot, Kit.once("ohUpdFade", 500.0, 400.0 + at * 280.0))
			var away: bool = seat["away"]
			var body := s.group(shown, {"opacity": 0.45 if away else 1.0})
			player(body, seat["colour"], float(seat["y"]) > 110.0)
			if away:
				s.circle(shown, 0, 0, 19, Kit.with({"fill": null, "stroke": FAINT, "dash": [3, 5], "width": 1.5}, Kit.always("ohUpdSpin", 9000.0, 0.0)))
			else:
				s.circle(shown, 0, 0, 13, Kit.with({"fill": null, "opacity": 0.45, "stroke": seat["colour"], "width": 1.6}, Kit.always("ohUpdRing", 3000.0, 1800.0 + at * 1000.0, RISE)))
		var free := at_point(root, FREE_SEAT["x"], FREE_SEAT["y"])
		holders["free"] = free
		_fill_joined()
		if narrow:
			return
		var lobby := card(22)
		s.rect(lobby, 36, 50, 54, 5, {"fill": INK, "opacity": 0.7, "rx": 2.5})
		s.rect(lobby, 118, 50.5, 30, 4, {"fill": FAINT, "rx": 2})
		s.line(lobby, 22, 64, 162, 64, {"stroke": LINE})
		var lobby_colours: Array = [AMBER, CORAL, GREEN, IVORY, null]
		var widths := [62.0, 48.0, 56.0, 52.0]
		for at in range(5):
			var y := 82.0 + at * 20.0
			var tint: Variant = lobby_colours[at]
			if tint == null:
				s.circle(lobby, 40, y, 5, {"fill": null, "stroke": FAINT, "dash": [2, 2]})
			else:
				s.circle(lobby, 40, y, 5, {"fill": tint, "opacity": 0.5 if at == 3 else 1.0})
				s.rect(lobby, 54, y - 2.5, widths[at], 5, {"fill": Kit.ink(0.3), "rx": 2.5})
			var mark := at_point(lobby, 146, y)
			if at == 3:
				s.circle(mark, 0, 0, 5, {"fill": null, "stroke": FAINT, "width": 1.2})
				var hand := s.group(mark, Kit.always("ohUpdSpin", 4000.0, 0.0))
				s.circle(hand, 0, 0, 5, {"fill": null})
				s.line(hand, 0, 0, 0, -3.4, {"stroke": INK, "cap": "round", "width": 1.3})
			if at < 3:
				s.circle(mark, 0, 0, 2.4, {"fill": INK, "opacity": 0.5})
			if at == 4:
				s.path(mark, "M-3.5 0h7M0 -3.5v7", {"fill": null, "stroke": FAINT, "cap": "round", "width": 1.3})
		var turn := card(638)
		for at in range(2):
			var x := 652.0 + at * 74.0
			s.rect(turn, x, 50, 40, 34, {"fill": STAGE, "rx": 3, "stroke": LINE})
			s.rect(turn, x, 50, 40, 8, {"fill": INK if at == 1 else FAINT, "opacity": 0.7 if at == 1 else 1.0, "rx": 2})
			s.rect(turn, x + 12, 64, 7, 10, {"fill": INK, "opacity": 0.65, "rx": 2})
			s.rect(turn, x + 21, 64, 7, 10, {"fill": INK, "opacity": 0.65, "rx": 2})
		s.path(turn, "M698 67 H718 M713 62 L719 67 L713 72", {"fill": null, "stroke": FAINT, "cap": "round", "join": "round", "width": 1.5})
		s.rect(turn, 652, 98, 114, 6, {"fill": LINE, "rx": 3})
		s.rect(turn, 652, 98, 114, 6, Kit.with({"fill": INK, "opacity": 0.75, "rx": 3, "origin": "left"}, Kit.always("ohUpdGrow", 6000.0, 900.0)))
		var rows := [122.0, 141.0, 160.0]
		for at in range(3):
			var y: float = rows[at]
			var event := s.group(turn, Kit.always("ohUpdTwinkle", 3600.0, at * 1200.0, PULSE))
			s.path(event, "M658 %s l4 4 -4 4 -4 -4z" % (y - 4.0), {"fill": ROUND[at]})
			s.rect(event, 670, y - 2.0, 88.0 - at * 14.0, 4, {"fill": Kit.ink(0.32), "rx": 2})

	func _fill_joined() -> void:
		var claimed := _clear("claim")
		if joined:
			claim(claimed, FREE_SEAT, ACCENT, 0.0)
		var free := _clear("free")
		if joined:
			var sat := scene.group(free, Kit.once("ohUpdFade", 400.0, 0.0))
			player(sat, ACCENT, true)
		else:
			var empty := scene.group(free, Kit.always("ohUpdPulse", 2200.0, 0.0, PULSE))
			scene.rect(empty, -20, 9, 40, 10, {"fill": CHAIR, "rx": 4, "stroke": LINE})
			scene.ellipse(empty, 0, 0, 15, 8, {"fill": null, "stroke": FAINT, "dash": [3, 3], "width": 1.3})
		scene.restart(claimed)
		scene.restart(free)

	func _ledger() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		s.rect(root, 0, 189, 800, 31, {"fill": TABLE})
		s.line(root, 0, 189.5, 800, 189.5, {"stroke": Kit.ink(0.16), "width": 1.5})
		var world := at_point(root, 400, 37)
		s.circle(world, 0, 0, 15, Kit.with({"fill": null, "stroke": ACCENT, "width": 1.4, "opacity": 0.4}, Kit.always("ohUpdRing", 2600.0, 0.0, RISE)))
		s.circle(world, 0, 0, 15, {"fill": SEA, "stroke": ACCENT, "width": 1.6})
		s.ellipse(world, 0, 0, 6, 15, {"fill": null, "stroke": ACCENT, "stroke_opacity": 0.55, "width": 1.1})
		s.line(world, -15, 0, 15, 0, {"stroke": ACCENT, "stroke_opacity": 0.45})
		for at in range(DEVICES.size()):
			var risen := s.group(root, Kit.once("ohUpdRise", 600.0, 300.0 + at * 160.0))
			_device(risen, DEVICES[at], at)
		var token_at := at_point(root, 232, 101)
		var token := s.group(token_at)
		s.circle(token, 0, 0, 8.5, {"fill": INK, "stroke": STAGE, "width": 2.0})
		s.circle(token, 0, 0, 5.2, {"fill": null, "stroke": STAGE, "stroke_opacity": 0.5, "width": 1.2})
		s.path(token, "M0 -3.6 L1 -1 L3.6 0 L1 1 L0 3.6 L-1 1 L-3.6 0 L-1 -1 Z", {"fill": STAGE})
		if not still:
			drive(token, "ohWorldsRelay", RELAY_MS, 0.0, SWING, true)
		if narrow:
			return
		var ledger := s.group(root, Kit.once("ohUpdFade", 700.0, 500.0))
		s.rect(ledger, 26, 35, 132, 150, {"fill": PAPER, "rx": 3})
		s.rect(ledger, 26, 35, 8, 150, {"fill": PAPER_BACK})
		s.rect(ledger, 46, 48, 60, 6, {"fill": PAPER_INK, "opacity": 0.75, "rx": 2})
		for at in range(6):
			var y := 72.0 + at * 18.0
			var row := s.group(ledger, Kit.once("ohUpdFade", 400.0, 700.0 + at * 160.0))
			var paid := {"fill": ROUND[at % 4], "rx": 2}
			if at == 5:
				paid = Kit.with(paid, Kit.always("ohUpdPulse", 1800.0, 0.0, PULSE))
			s.rect(row, 46, y - 4.5, 9, 9, paid)
			s.rect(row, 62, y - 2.0, 56.0 - (at % 3) * 10.0, 4, {"fill": PAPER_INK, "opacity": 0.4, "rx": 2})
			s.path(row, TICKED, {"fill": null, "stroke": PAPER_INK, "cap": "round", "join": "round", "stroke_opacity": 0.6, "width": 1.6, "transform": Transform2D(0.0, Vector2(142, y))})
		var master := card(638)
		var eye := at_point(master, 708, 66)
		s.circle(eye, 0, 0, 20, Kit.with({"fill": null, "opacity": 0.5, "stroke": FAINT, "width": 1.2}, Kit.always("ohUpdRing", 2800.0, 400.0, RISE)))
		s.path(eye, "M-19 0 Q0 -14 19 0 Q0 14 -19 0 Z", {"fill": null, "stroke": INK, "width": 1.6})
		s.circle(eye, 0, 0, 5, {"fill": INK})
		s.circle(eye, 0, 0, 1.8, {"fill": RAISED})
		var rows := [108.0, 132.0, 156.0]
		for at in range(3):
			var y: float = rows[at]
			var change := s.group(master, Kit.always("ohUpdTwinkle", 3600.0, at * 1200.0, PULSE))
			s.rect(change, 652, y - 8.0, 112, 16, {"fill": STAGE, "rx": 4})
			s.rect(change, 660, y - 2.0, 42, 4, {"fill": FAINT, "rx": 2})
			for index in range(4):
				s.circle(change, 720.0 + index * 9.0, y, 2.6, {"fill": ROUND[index]})

	func _device(parent: Scene.Shape, device: Dictionary, at: int) -> void:
		var s := scene
		var x: float = device["x"]
		var colour: Color = device["colour"]
		var frame: Array = device["frame"]
		var screen: Array = device["screen"]
		var sx: float = screen[0]
		var sy: float = screen[1]
		var sw: float = screen[2]
		var sh: float = screen[3]
		var sr: float = screen[4]
		var g := at_point(parent, x, 0)
		var wire := "M0 %s Q0 60 %s 53" % [float(frame[1]) - 4.0, 400.0 - x]
		s.path(g, wire, {"fill": null, "stroke": LINE, "dash": [3, 4], "width": 1.3})
		var lit_wire := s.path(g, wire, {"fill": null, "stroke": colour, "width": 2.0})
		_lit(lit_wire, at)
		match str(device["kind"]):
			"monitor":
				s.rect(g, -4, 170, 8, 13, {"fill": FRAME})
				s.rect(g, -18, 183, 36, 6, {"fill": FRAME, "rx": 2, "stroke": LINE})
			"laptop":
				s.path(g, "M-42 178 H42 L36 189 H-36 Z", {"fill": FRAME, "stroke": colour, "join": "round", "stroke_opacity": 0.6, "width": 1.2})
		s.rect(g, frame[0], frame[1], frame[2], frame[3], {"fill": FRAME, "rx": frame[4], "stroke": colour, "width": 1.6})
		s.rect(g, sx, sy, sw, sh, {"fill": SCREEN, "rx": sr})
		var glow := s.group(g, {"opacity": 0.28})
		var lit_screen := s.rect(glow, sx, sy, sw, sh, {"fill": colour, "rx": sr})
		_lit(lit_screen, at)
		var key := at_point(g, 0, sy + sh / 2.0 - 3.0)
		s.circle(key, -5, 0, 4, {"fill": null, "stroke": colour, "width": 2.0})
		s.path(key, "M-1 0 H9 M5 0 V3.5 M8 0 V3", {"fill": null, "stroke": colour, "cap": "round", "width": 2.0})
		for dx in [-6.0, -2.0, 2.0, 6.0]:
			s.circle(key, dx, 10, 1.3, {"fill": FAINT})

	func _lit(shape: Scene.Shape, at: int) -> void:
		if still:
			shape.opacity = 1.0 if at == 0 else 0.0
			return
		drive(shape, "ohWorldsTurn", RELAY_MS, 0.0 if at == 0 else at * (RELAY_MS / 4.0) - RELAY_MS, "linear", true)

	func _standing(parent: Scene.Shape, shape_name: String, colour: Color) -> void:
		var s := scene
		match shape_name:
			"fort":
				s.path(parent, "M-9 7 V-5 H-6 V-2 H-2 V-5 H2 V-2 H6 V-5 H9 V7 Z", {"fill": colour, "stroke": STAGE, "width": 1.0})
			"city":
				s.path(parent, "M-9 7 V-1 H-4 V-7 H2 V-3 H8 V7 Z", {"fill": colour, "stroke": STAGE, "join": "round", "width": 1.0})
			"works":
				s.path(parent, "M-9 7 V-2 L-4 -6 V-2 L1 -6 V-2 L5 -5 V-9 H8 V7 Z", {"fill": colour, "stroke": STAGE, "join": "round", "width": 1.0})
			_:
				s.path(parent, "M-11 1 H11 L8 7 H-8 Z", {"fill": colour, "stroke": STAGE, "join": "round", "width": 1.0})
				s.rect(parent, -9, -4, 17, 5, {"fill": colour, "rx": 1.5, "stroke": STAGE, "width": 1.0})
				s.line(parent, 1, -6, 12, -8, {"stroke": colour, "cap": "round", "width": 2.0})
				s.circle(parent, -1, -5, 3.5, {"fill": colour, "stroke": STAGE, "width": 1.0})

	func _map_under(parent: Scene.Shape) -> void:
		var s := scene
		for entry in THEIR_LANDS:
			s.path(parent, Kit.polygon_path(entry[1]), {"fill": LAND, "stroke": SEA, "join": "round", "width": 2.0})
			s.path(parent, Kit.polygon_path(entry[1]), {"fill": entry[0], "opacity": 0.22})
		for thing in STANDING:
			_standing(at_point(parent, thing["x"], thing["y"]), thing["shape"], thing["colour"])

	func _secrets() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		s.rect(root, BOARD.position.x, BOARD.position.y, BOARD.size.x, BOARD.size.y, {"fill": SEA, "rx": 6, "stroke": LINE})
		_map_under(root)
		var board := s.group(root)
		board.clip = UpdateKit.rounded(BOARD, 6.0)
		var far := s.group(board)
		var near := s.group(board)
		for at in range(72):
			var column := at % 12
			var row := floori(at / 12.0)
			var x := 176.0 + column * 42.0 + (row % 2) * 21.0
			var y := 14.0 + row * 38.0
			var radius := 26.0 + ((column * 7 + row * 5) % 4) * 4.0
			s.circle(far, x, y, radius, {"fill": FOG})
			if at % 3 == 1:
				s.circle(near, x + 12.0, y + 8.0, radius * 0.7, {"fill": FOG_NEAR})
		if not still:
			drive(far, "ohWorldsDrift", 11000.0, 0.0, SWING, true, {"drift": 18.0})
			drive(near, "ohWorldsDrift", 8000.0, 0.0, SWING, true, {"drift": -22.0})
		for at in range(STANDING.size()):
			var thing: Dictionary = STANDING[at]
			var centre := Vector2(thing["x"], thing["y"])
			var hole := s.group(root)
			hole.clip = Kit.ring_points(centre, 21.0)
			s.rect(hole, BOARD.position.x, BOARD.position.y, BOARD.size.x, BOARD.size.y, {"fill": SEA, "rx": 6})
			_map_under(hole)
			if not still:
				drive(hole, "ohWorldsOpen", 900.0, 1100.0 + at * 650.0, "cubic-bezier(0.3, 0.7, 0.3, 1)", false, {}, "", centre)
		var yours := s.group(root)
		yours.clip = Geometry2D.offset_polygon(Kit.points(YOUR_LAND), 0.3, Geometry2D.JOIN_MITER)[0]
		s.path(yours, Kit.polygon_path(YOUR_LAND), {"fill": LAND_CLEAR, "stroke": SEA, "join": "round", "width": 2.0})
		s.path(yours, Kit.polygon_path(YOUR_LAND), {"fill": null, "stroke": AMBER, "join": "round", "stroke_opacity": 0.85, "width": 2.0})
		_standing(at_point(yours, 258, 92), "city", AMBER)
		var order := s.group(yours, Kit.once("ohUpdFade", 600.0, 700.0))
		s.path(order, "M268 88 Q292 76 314 80", {"fill": null, "stroke": AMBER, "dash": [4, 4], "cap": "round", "width": 2.0})
		s.path(order, "M310 74 L319 80 L310 86 Z", {"fill": AMBER})
		for at in range(STANDING.size()):
			var thing: Dictionary = STANDING[at]
			var spot := at_point(root, thing["x"], thing["y"])
			var opening := s.group(spot)
			s.circle(opening, 0, 0, 21, {"fill": null, "stroke": Kit.ink(0.35), "dash": [3, 3]})
			if not still:
				drive(opening, "ohWorldsOpen", 900.0, 1100.0 + at * 650.0, "cubic-bezier(0.3, 0.7, 0.3, 1)", false)
		var sealed := [[CORAL, 556.0, 92.0, -5.0], [GREEN, 360.0, 158.0, 4.0]]
		for at in range(2):
			var entry: Array = sealed[at]
			var spot := at_point(root, entry[1], entry[2])
			var bob := s.group(spot, Kit.always("ohUpdBob", 4600.0 + at * 700.0, at * 900.0, SWING, {"tilt": entry[3]}))
			s.rect(bob, -13, -9, 26, 18, {"fill": PAPER, "rx": 1.5})
			s.path(bob, "M-13 -9 L0 2 L13 -9", {"fill": null, "stroke": PAPER_INK, "stroke_opacity": 0.5, "width": 1.0})
			s.circle(bob, 0, 1, 4, {"fill": entry[0], "stroke": PAPER_INK, "stroke_opacity": 0.4})
		s.rect(root, 230, 138, 56, 36, {"fill": PAPER_BACK, "rx": 2})
		_holder("letter_open")
		s.path(root, "M230 146 L258 164 L286 146 V174 H230 Z", {"fill": PAPER})
		_holder("letter_shut")
		_fill_letter()
		if narrow:
			return
		var orders := [[AMBER, 30.0, 46.0, -3.0], [CORAL, 38.0, 92.0, 2.0], [GREEN, 28.0, 138.0, -1.5]]
		for at in range(3):
			var entry: Array = orders[at]
			var x: float = entry[1]
			var y: float = entry[2]
			var risen := s.group(root, Kit.once("ohUpdRise", 600.0, 500.0 + at * 180.0))
			var tilted := s.group(risen, {"transform": Transform2D(deg_to_rad(float(entry[3])), Vector2.ZERO)})
			s.rect(tilted, x, y, 118, 36, {"fill": RAISED, "rx": 3, "stroke": LINE})
			s.rect(tilted, x + 10.0, y + 11.0, 64, 4, {"fill": FAINT, "rx": 2})
			s.rect(tilted, x + 10.0, y + 21.0, 48, 4, {"fill": Kit.ink(0.2), "rx": 2})
			s.circle(tilted, x + 100.0, y + 18.0, 8, {"fill": entry[0], "stroke": STAGE, "width": 1.5})
			s.circle(tilted, x + 100.0, y + 18.0, 4.5, {"fill": null, "stroke": STAGE, "stroke_opacity": 0.45})
		var advisor := card(642)
		s.circle(advisor, 668, 60, 9, {"fill": FOG, "stroke": FAINT})
		s.path(advisor, "M652 86 Q668 70 684 86 Z", {"fill": FOG})
		var lines := [[52.0, 46.0], [60.0, 38.0], [68.0, 30.0]]
		for entry in lines:
			s.rect(advisor, 694, entry[0], entry[1], 3.5, {"fill": FAINT, "rx": 1.75})
		var watch := s.group(advisor, Kit.with({"transform": Transform2D(0.0, Vector2(758, 54))}, Kit.always("ohUpdPulse", 2400.0, 0.0, PULSE)))
		s.path(watch, "M-9 0 Q0 -7 9 0 Q0 7 -9 0 Z", {"fill": null, "stroke": INK, "width": 1.3})
		s.circle(watch, 0, 0, 2.4, {"fill": INK})
		var rows := [110.0, 134.0, 158.0]
		for at in range(3):
			var y: float = rows[at]
			s.rect(advisor, 656, y - 6.0, 12, 12, {"fill": null, "rx": 2, "stroke": Kit.ink(0.45)})
			s.path(advisor, TICKED, Kit.with({"fill": null, "stroke": GREEN, "cap": "round", "join": "round", "width": 2.0, "transform": Transform2D(0.0, Vector2(662, y))}, Kit.always("ohUpdTwinkle", 3600.0, at * 1200.0, PULSE)))
			s.rect(advisor, 676, y - 2.0, 82.0 - at * 12.0, 4, {"fill": Kit.ink(0.3), "rx": 2})

	func _fill_letter() -> void:
		var s := scene
		var opened := _clear("letter_open")
		var shut := _clear("letter_shut")
		if open:
			var flap := s.path(opened, "M230 138 L258 117 L286 138 Z", {"fill": PAPER_BACK, "stroke": PAPER_INK, "stroke_opacity": 0.35, "origin": {"kind": "view", "at": Vector2(258, 138)}})
			var slide := s.group(opened)
			s.rect(slide, 236, 104, 44, 52, {"fill": INK, "rx": 1.5})
			var rows := [114.0, 122.0, 130.0, 138.0]
			for at in range(4):
				s.rect(slide, 242, rows[at], 18.0 if at == 3 else 30.0, 3, {"fill": PAPER_INK, "opacity": 0.5, "rx": 1.5})
			s.path(slide, "M270 108 V120 M270 108 H278 L276 111 L278 114 H270", {"fill": AMBER, "stroke": AMBER, "join": "round", "width": 1.2})
			if not still:
				drive(flap, "ohWorldsFlip", 450.0, 0.0, "cubic-bezier(0.4, 0, 0.2, 1)", false, {}, "letter_open")
				drive(slide, "ohWorldsSlide", 700.0, 300.0, RISE, false, {"slide": 34.0}, "letter_open")
		else:
			s.path(shut, "M230 138 L258 160 L286 138 Z", {"fill": PAPER, "stroke": PAPER_INK, "stroke_opacity": 0.35})
			s.circle(shut, 258, 158, 6, {"fill": AMBER, "stroke": SEAL_RIM, "width": 1.5})
		s.restart(opened)
		s.restart(shut)

	func _envoys() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		var treaty := s.group(root, Kit.once("ohUpdRise", 600.0, 200.0))
		s.rect(treaty, 316, 24, 168, 172, {"fill": PAPER, "rx": 3})
		s.circle(treaty, 400, 42, 7, {"fill": null, "stroke": PAPER_INK, "stroke_opacity": 0.55, "width": 1.4})
		var widths := [136.0, 120.0, 136.0, 104.0, 136.0, 112.0]
		for at in range(widths.size()):
			s.rect(treaty, 332, 60.0 + at * 11.0, widths[at], 4, Kit.with({"fill": PAPER_INK, "opacity": 0.45, "rx": 2, "origin": "left"}, Kit.once("ohUpdGrow", 420.0, 500.0 + at * 150.0, "cubic-bezier(0.3, 0, 0.2, 1)")))
		s.line(treaty, 330, 178, 392, 178, {"stroke": PAPER_INK, "stroke_opacity": 0.5})
		s.line(treaty, 408, 178, 470, 178, {"stroke": PAPER_INK, "stroke_opacity": 0.5})
		s.path(root, SIGNED_FIRST, Kit.with({"fill": null, "stroke": AMBER, "cap": "round", "join": "round", "width": 2.0}, drawn(160.0, 900.0, 1500.0)))
		_holder("signed")
		var sides := [[AMBER, 238.0, -1.0], [CORAL, 562.0, 1.0]]
		for at in range(2):
			var entry: Array = sides[at]
			var colour: Color = entry[0]
			var side: float = entry[2]
			var place := at_point(root, entry[1], 0)
			var walk := s.group(place, {} if still else Kit.once("ohUpdDrift", 1300.0, 150.0 + at * 200.0, "cubic-bezier(0.25, 0.6, 0.3, 1)", {"from": side * 50.0, "to": 0.0}))
			s.line(walk, side * 26.0, 196, side * 26.0, 50, {"stroke": INK, "stroke_opacity": 0.5, "width": 2.0})
			s.path(walk, "M%s 52 L%s 60 L%s 68 Z" % [side * 26.0, side * 56.0, side * 26.0], Kit.with({"fill": colour, "origin": "right" if side < 0.0 else "left"}, Kit.always("ohUpdSway", 3400.0 + side * 300.0, 0.0, SWING)))
			s.path(walk, "M-17 196 L-12 106 Q0 98 12 106 L17 196 Z", {"fill": colour})
			s.path(walk, "M%s 110 L%s 150" % [side * 10.0, side * -12.0], {"fill": null, "stroke": STAGE, "stroke_opacity": 0.35, "width": 3.0})
			s.circle(walk, 0, 88, 11, {"fill": colour, "stroke": STAGE, "width": 2.0})
			s.rect(walk, 8.0 if side < 0.0 else -34.0, 126, 26, 8, {"fill": PAPER, "rx": 4})
			s.line(place, side * -36.0, 130, side * -78.0, 130, Kit.with({"stroke": colour, "dash": [4, 4], "width": 1.5}, Kit.once("ohUpdFade", 600.0, 1300.0 + at * 200.0)))
		_fill_signed()
		if narrow:
			return
		var box := s.group(root, Kit.once("ohUpdFade", 700.0, 500.0))
		for at in range(4):
			var slot := at_point(box, 80.0 + at * 8.0, 52.0 + (at * 10.0 if still else 0.0))
			var ballot := s.group(slot, Kit.always("ohUpdFall", 3600.0, at * 900.0, "cubic-bezier(0.5, 0, 0.9, 0.6)", {"fall": 66.0}))
			s.rect(ballot, -10, -7, 20, 14, {"fill": ROUND[at], "rx": 2})
			s.path(ballot, TICKED, {"fill": null, "stroke": STAGE, "cap": "round", "join": "round", "width": 1.6})
		s.rect(box, 46, 126, 92, 62, {"fill": RAISED, "rx": 4, "stroke": FAINT})
		s.rect(box, 40, 118, 104, 10, {"fill": CHAIR, "rx": 2, "stroke": FAINT})
		s.rect(box, 70, 121, 44, 4, {"fill": STAGE, "rx": 2})
		s.path(box, "M80 156 L88 164 L104 146", {"fill": null, "stroke": FAINT, "cap": "round", "join": "round", "width": 3.0})
		var hall := s.group(root, Kit.once("ohUpdFade", 700.0, 600.0))
		s.path(hall, "M648 78 L708 48 L768 78 Z", {"fill": RAISED, "stroke": FAINT, "join": "round"})
		s.rect(hall, 648, 78, 120, 7, {"fill": RAISED, "stroke": FAINT})
		for x in [663.0, 693.0, 723.0, 753.0]:
			s.rect(hall, x - 5.0, 85, 10, 46, {"fill": CHAIR, "stroke": FAINT})
		s.rect(hall, 644, 131, 128, 6, {"fill": RAISED, "stroke": FAINT})
		s.rect(hall, 638, 137, 140, 6, {"fill": RAISED, "stroke": FAINT})
		for at in range(4):
			var member := at_point(hall, 663.0 + at * 30.0, 0)
			s.circle(member, 0, 168, 7, {"fill": ROUND[at], "stroke": STAGE, "width": 1.5})
			s.path(member, TICKED, Kit.with({"fill": null, "stroke": ROUND[at], "cap": "round", "join": "round", "width": 2.0, "transform": Transform2D(0.0, Vector2(0, 153))}, Kit.always("ohUpdTwinkle", 2800.0, at * 700.0, PULSE)))

	func _fill_signed() -> void:
		var s := scene
		var held := _clear("signed")
		if signs > 0:
			s.path(held, SIGNED_SECOND, Kit.with({"fill": null, "stroke": CORAL, "cap": "round", "join": "round", "width": 2.0}, drawn(160.0, 800.0, 0.0)))
			var spot := at_point(held, 400, 142)
			var seal := s.group(spot, Kit.once("ohUpdStamp", 600.0, 750.0))
			s.circle(seal, 0, 0, 17, {"fill": null, "stroke": PAPER_INK, "dash": [2, 3], "stroke_opacity": 0.5})
			s.path(seal, "M0 -13 A13 13 0 0 0 0 13 Z", {"fill": AMBER})
			s.path(seal, "M0 -13 A13 13 0 0 1 0 13 Z", {"fill": CORAL})
			s.path(seal, "M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z", {"fill": PAPER})
		else:
			var spot := at_point(held, 500, 170)
			s.circle(spot, 0, 0, 16, Kit.with({"fill": null, "opacity": 0.6, "stroke": CORAL, "width": 1.5}, Kit.always("ohUpdRing", 2400.0, 2200.0, RISE)))
			s.circle(held, 400, 142, 13, {"fill": null, "stroke": PAPER_INK, "dash": [3, 3], "stroke_opacity": 0.3})
		s.restart(held)

	func _sortie(parent: Scene.Shape, colour: Color, from: float, y: float, to: float, delay: float, again: bool, owner_key: String) -> void:
		var s := scene
		if still and not again:
			return
		var run := to - from
		var start := at_point(parent, from, y)
		var flight := s.group(start)
		var plane := {"fill": colour, "stroke": STAGE, "width": 0.8}
		if colour != AMBER:
			plane["css"] = [["scale", -1.0, 1.0]]
		s.path(flight, PLANE, plane)
		if still:
			flight.offset = Vector2(run * 0.6, 0)
			flight.uses_css = true
			return
		drive(flight, "ohWorldsSortie", SORTIE_MS if again else 1700.0, delay, "linear", again, {"run": run}, owner_key)
		var target := at_point(parent, to, y)
		var hit := s.group(target)
		s.circle(hit, 0, 0, 9, {"fill": null, "stroke": colour, "width": 2.0})
		drive(hit, "ohWorldsHit", SORTIE_MS if again else 1700.0, delay, "linear", again, {}, owner_key)

	func _crater(parent: Scene.Shape, colour: Color) -> void:
		scene.circle(parent, 0, 0, 5.5, {"fill": null, "opacity": 0.35, "stroke": colour})
		scene.path(parent, "M-3 -3 L3 3 M3 -3 L-3 3", {"fill": null, "stroke": colour, "cap": "round", "width": 1.6})

	func _fronts() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		s.rect(root, 0, 0, 800, H, {"fill": GRASS})
		var line_text := ""
		for point in FRONT:
			line_text += "%s,%s " % [point[0], point[1]]
		line_text = line_text.strip_edges()
		s.path(root, Kit.polygon_path("0,0 " + line_text + " 0,%s" % H), {"fill": AMBER, "opacity": 0.07})
		s.path(root, Kit.polygon_path(line_text + " 800,%s 800,0" % H), {"fill": CORAL, "opacity": 0.07})
		for at in range(21):
			s.line(root, at * 40.0, 0, at * 40.0, H, {"stroke": Kit.ink(0.05)})
		for at in range(6):
			s.line(root, 0, at * 40.0, 800, at * 40.0, {"stroke": Kit.ink(0.05)})
		for entry in [[300.0, 70.0, 60.0, 24.0], [520.0, 150.0, 70.0, 28.0], [250.0, 170.0, 44.0, 18.0]]:
			s.ellipse(root, entry[0], entry[1], entry[2], entry[3], {"fill": null, "stroke": Kit.ink(0.08)})
			s.ellipse(root, entry[0], entry[1], entry[2] * 0.6, entry[3] * 0.6, {"fill": null, "stroke": Kit.ink(0.08)})
		var front_path := ""
		for at in range(FRONT.size()):
			front_path += ("M" if at == 0 else " L") + "%s %s" % [FRONT[at][0], FRONT[at][1]]
		s.path(root, front_path, Kit.with({"fill": null, "stroke": INK, "join": "round", "stroke_opacity": 0.85, "width": 3.0}, drawn(260.0, 1400.0, 300.0)))
		for at in range(FRONT.size() - 1):
			var x0: float = FRONT[at][0]
			var y0: float = FRONT[at][1]
			var x1: float = FRONT[at + 1][0]
			var y1: float = FRONT[at + 1][1]
			var length := Vector2(x1 - x0, y1 - y0).length()
			var dx := (x1 - x0) / length
			var dy := (y1 - y0) / length
			var facing := 1.0 if at % 2 == 0 else -1.0
			var mx := (x0 + x1) / 2.0
			var my := (y0 + y1) / 2.0
			var tooth := "%s,%s %s,%s %s,%s" % [mx - dx * 6.0, my - dy * 6.0, mx + dx * 6.0, my + dy * 6.0, mx + dy * 8.0 * facing, my - dx * 8.0 * facing]
			s.path(root, Kit.polygon_path(tooth), Kit.with({"fill": AMBER if facing > 0.0 else CORAL}, Kit.once("ohUpdFade", 400.0, 900.0 + at * 120.0)))
		for entry in CRATERS:
			var spot := at_point(root, entry[1], entry[2])
			_crater(s.group(spot, Kit.once("ohUpdFade", 500.0, 1600.0)), entry[0])
		var sorties := [[AMBER, 176.0, 48.0, 0.0], [CORAL, 628.0, 90.0, 1300.0], [AMBER, 170.0, 122.0, 2600.0], [CORAL, 630.0, 152.0, 3900.0]]
		for entry in sorties:
			var y: float = entry[2]
			var to := Kit.front_at(y) + (24.0 if entry[0] == AMBER else -24.0)
			_sortie(root, entry[0], entry[1], y, to, entry[3], true, "")
		_holder("strikes")
		s.line(root, 400, 182, 400, 211, {"stroke": INK, "stroke_opacity": 0.6, "width": 2.5})
		s.rect(root, 382, 209, 36, 5, {"fill": INK, "opacity": 0.6, "rx": 2})
		var scales := s.group(root, Kit.with({"origin": {"kind": "view", "at": Vector2(400, 179)}}, Kit.always("ohUpdSway", 4200.0, 0.0, SWING)))
		s.circle(scales, 400, 182, 3, {"fill": INK})
		s.line(scales, 352, 182, 448, 182, {"stroke": INK, "cap": "round", "width": 2.5})
		for entry in [[352.0, AMBER], [448.0, CORAL]]:
			var x: float = entry[0]
			s.path(scales, "M%s 182 L%s 198 M%s 182 L%s 198" % [x, x - 12.0, x, x + 12.0], {"fill": null, "stroke": INK, "stroke_opacity": 0.5, "width": 1.0})
			s.rect(scales, x - 6.0, 191, 12, 7, {"fill": entry[1], "rx": 1.5})
			s.path(scales, "M%s 198 Q%s 207 %s 198 Z" % [x - 14.0, x, x + 14.0], {"fill": INK, "opacity": 0.75})
		if narrow:
			return
		var forces := card(22)
		for at in range(15):
			var x := 38.0 + (at % 5) * 24.0
			var y := 50.0 + floori(at / 5.0) * 22.0
			if at < 11:
				var unit := s.group(forces, Kit.once("ohUpdFade", 300.0, 500.0 + at * 70.0))
				s.rect(unit, x, y, 18, 13, {"fill": AMBER, "stroke": STAGE})
				s.path(unit, "M%s %s L%s %s M%s %s L%s %s" % [x, y, x + 18.0, y + 13.0, x + 18.0, y, x, y + 13.0], {"fill": null, "stroke": STAGE})
			else:
				s.rect(forces, x, y, 18, 13, {"fill": null, "stroke": FAINT, "dash": [2, 2]})
		s.line(forces, 34, 130, 150, 130, {"stroke": FAINT, "dash": [3, 3]})
		for at in range(3):
			var x := 38.0 + at * 24.0
			s.rect(forces, x, 148, 18, 13, {"fill": GREEN, "stroke": STAGE})
			s.path(forces, "M%s 148 L%s 161 M%s 148 L%s 161" % [x, x + 18.0, x + 18.0, x], {"fill": null, "stroke": STAGE})
		var ranking := card(638)
		var shares := [[GREEN, 0.9], [AMBER, 0.74], [CORAL, 0.62], [IVORY, 0.46]]
		for at in range(4):
			var entry: Array = shares[at]
			var y := 62.0 + at * 32.0
			s.circle(ranking, 656, y, 7, {"fill": entry[0]})
			s.circle(ranking, 656, y, 2.6, {"fill": STAGE})
			s.rect(ranking, 670, y - 3.0, 96, 6, {"fill": LINE, "rx": 3})
			s.rect(ranking, 670, y - 3.0, 96.0 * float(entry[1]), 6, Kit.with({"fill": entry[0], "rx": 3, "origin": "left"}, Kit.once("ohUpdGrow", 1100.0, 600.0 + at * 220.0, "cubic-bezier(0.3, 0, 0.2, 1)")))

	func _fill_strikes() -> void:
		var s := scene
		var held: Scene.Shape = holders["strikes"]
		var oldest := maxi(1, strikes - 5)
		for flown in flights.keys():
			if int(flown) < oldest:
				held.children.erase(flights[flown])
				flights.erase(flown)
				_drop_drives("strike%d" % int(flown))
		var newest := strikes
		var high := 34.0 + float((newest * 29) % 120)
		var low := 46.0 + float((newest * 41) % 110)
		var group := Scene.Shape.new()
		group.kind = "g"
		held.children.insert(0, group)
		flights[newest] = group
		var key := "strike%d" % newest
		var amber_to := Kit.front_at(high) + 14.0 + float(newest % 3) * 6.0
		var coral_to := Kit.front_at(low) - 14.0 - float(newest % 3) * 6.0
		for entry in [[AMBER, 190.0, high, amber_to], [CORAL, 610.0, low, coral_to]]:
			_sortie(group, entry[0], entry[1], entry[2], entry[3], 0.0, false, key)
			var spot := at_point(group, entry[3], entry[2])
			_crater(s.group(spot, Kit.once("ohUpdFade", 300.0, 1350.0)), entry[0])
		held.box_ready = false
		s.restart(group)

class Corners extends Control:
	var narrow := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		var arm := UpdateKit.px(1.1) if narrow else UpdateKit.px(1.5)
		var inset := UpdateKit.px(0.5) if narrow else UpdateKit.px(0.7)
		var thick := 2.0
		var right := size.x - inset
		var bottom := size.y - inset
		draw_rect(Rect2(inset, inset, arm, thick), AMBER)
		draw_rect(Rect2(inset, inset, thick, arm), AMBER)
		draw_rect(Rect2(right - arm, inset, arm, thick), CORAL)
		draw_rect(Rect2(right - thick, inset, thick, arm), CORAL)
		draw_rect(Rect2(right - arm, bottom - thick, arm, thick), GREEN)
		draw_rect(Rect2(right - thick, bottom - arm, thick, arm), GREEN)
		draw_rect(Rect2(inset, bottom - thick, arm, thick), IVORY)
		draw_rect(Rect2(inset, bottom - arm, thick, arm), IVORY)


class Seats extends Control:
	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_vertical = Control.SIZE_SHRINK_CENTER

	func _ready() -> void:
		var side := UpdateKit.px(0.45)
		custom_minimum_size = Vector2(side * 4.0 + UpdateKit.px(0.3) * 3.0, side)

	func _draw() -> void:
		var side := UpdateKit.px(0.45)
		var gap := UpdateKit.px(0.3)
		for at in range(4):
			draw_circle(Vector2(side * 0.5 + at * (side + gap), size.y * 0.5), side * 0.5, ROUND[at], true, -1.0, true)


class Bead extends Control:
	var colour := AMBER

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		size_flags_vertical = Control.SIZE_SHRINK_BEGIN

	func _ready() -> void:
		custom_minimum_size = Vector2(UpdateKit.px(0.4), UpdateKit.px(0.42) + UpdateKit.px(0.4))

	func _draw() -> void:
		var side := UpdateKit.px(0.4)
		draw_circle(Vector2(side * 0.5, UpdateKit.px(0.42) + side * 0.5), side * 0.5, colour, true, -1.0, true)


class SeatStyle extends StyleBox:
	var colour := AMBER
	var _base: StyleBoxFlat
	var _top: StyleBoxFlat

	func _draw(to_canvas_item: RID, area: Rect2) -> void:
		if not _base:
			_base = StyleBoxFlat.new()
			_base.bg_color = Color(231 / 255.0, 231 / 255.0, 234 / 255.0, 0.035)
			_base.border_color = LINE
			_base.set_border_width_all(1)
			_base.set_corner_radius_all(8)
			_base.anti_aliasing = true
			_top = StyleBoxFlat.new()
			_top.draw_center = false
			_top.border_color = colour
			_top.border_width_top = 3
			_top.set_corner_radius_all(8)
			_top.anti_aliasing = true
		_base.draw(to_canvas_item, area)
		_top.draw(to_canvas_item, area)


static func mark(size_px: float, still: bool) -> Control:
	var s := Scene.new(Rect2(0, 0, 48, 48), "meet", true)
	s.custom_minimum_size = Vector2(size_px, size_px)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var root: Scene.Shape = s.root
	s.circle(root, 24, 24, 14, {"fill": SEA, "stroke": ACCENT, "width": 1.8})
	s.ellipse(root, 24, 24, 6, 14, {"fill": null, "stroke": ACCENT, "stroke_opacity": 0.6, "width": 1.2})
	s.line(root, 10, 24, 38, 24, {"stroke": ACCENT, "stroke_opacity": 0.45, "width": 1.2})
	for at in range(4):
		var turn := deg_to_rad(at * 90.0 + 45.0)
		s.circle(root, 24.0 + sin(turn) * 20.0, 24.0 - cos(turn) * 20.0, 3.6, {"fill": ROUND[at], "stroke": GROUND, "width": 1.5})
	var holder := UpdateKit.Riser.new()
	holder.custom_minimum_size = Vector2(size_px, size_px)
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	holder.add_child(s)
	if not still:
		holder.play("ohUpdTurn", 800.0, 260.0)
	return holder


static func seat_cards(sections: Array, narrow: bool, still: bool) -> Control:
	var grid := UpdateKit.CardGrid.new()
	grid.fixed_columns = 1 if narrow else (2 if sections.size() == 4 else 0)
	grid.min_column = Kit.px(15.5)
	grid.gap = Kit.px(0.75)
	for index in range(sections.size()):
		if not (sections[index] is Dictionary):
			continue
		var section: Dictionary = sections[index]
		var colour: Color = ROUND[index % ROUND.size()]
		var panel := PanelContainer.new()
		panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var style := SeatStyle.new()
		style.colour = colour
		style.content_margin_left = 1.0 + Kit.px(0.85)
		style.content_margin_right = 1.0 + Kit.px(0.85)
		style.content_margin_top = 3.0 + Kit.px(0.75)
		style.content_margin_bottom = 1.0 + Kit.px(0.8)
		panel.add_theme_stylebox_override("panel", style)
		var column := UpdateKit.vbox(0)
		var head := UpdateKit.hbox(roundi(Kit.px(0.5)))
		head.add_child(UpdateKit.icon_rect(str(section.get("icon", "star")), 20, colour))
		var heading := UpdateKit.text(str(section.get("heading", "")), Kit.px(0.9), INK, FACE, 700, false, 0.01)
		heading.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		head.add_child(heading)
		column.add_child(head)
		column.add_child(UpdateKit.gap(Kit.px(0.5) - Kit.px(0.32)))
		for item in section.get("items", []):
			column.add_child(UpdateKit.gap(Kit.px(0.32)))
			var row := UpdateKit.hbox(roundi(Kit.px(0.5)))
			var bead := Bead.new()
			bead.colour = colour
			row.add_child(bead)
			row.add_child(UpdateKit.para(str(item), Kit.px(0.8), SOFT, FACE, 400, false, 1.45))
			column.add_child(row)
		panel.add_child(column)
		grid.add_child(UpdateKit.reveal(panel, 520.0 + float(index) * 110.0, still))
	return grid


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var seat := seat_of(banner)
	var plate := UpdateKit.plate({"background": GROUND, "border": Kit.ink(0.14), "radius": 12.0}, still)
	var column := UpdateKit.vbox(0)
	var stage := Stage.new()
	stage.setup(str(banner.get("scene", "table")), still, narrow, bool(ctx.get("sound", false)))
	column.add_child(UpdateKit.reveal(stage, 150.0, still))
	var stripe := UpdateKit.hbox(0)
	stripe.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for colour in ROUND:
		var band := ColorRect.new()
		band.color = colour
		band.custom_minimum_size = Vector2(0, 3)
		band.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		band.mouse_filter = Control.MOUSE_FILTER_IGNORE
		stripe.add_child(band)
	column.add_child(stripe)
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.hbox(roundi(Kit.px(0.75) if narrow else Kit.px(1.0)))
	head.alignment = BoxContainer.ALIGNMENT_BEGIN
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(mark(40.0 if narrow else 54.0, still))
	var words := UpdateKit.vbox(0)
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	words.add_child(UpdateKit.text(UpdateKit.major_line(update), Kit.px(0.7) if narrow else Kit.px(0.78), ACCENT, FACE, 700, false, 0.1 if narrow else 0.16, true))
	words.add_child(UpdateKit.gap(Kit.px(0.15)))
	var title := UpdateKit.para(str(banner.get("title", "")), Kit.px(1.85) if narrow else ShellFonts.clamp_vw(2.2, 5.5, 3.1, width), INK, FACE, 900, false, 1.04, -0.01)
	words.add_child(UpdateKit.reveal(title, 380.0, still, "ohUpdFade", 500.0))
	if not str(banner.get("subtitle", "")).is_empty():
		words.add_child(UpdateKit.gap(Kit.px(0.25)))
		words.add_child(UpdateKit.text(str(banner.get("subtitle", "")), Kit.px(0.95) if narrow else Kit.px(1.04), seat, FACE, 600))
	head.add_child(words)
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(Kit.px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), Kit.px(0.92) if narrow else Kit.px(0.98), SOFT, FACE, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(FAINT, Seats.new()))
	body.add_child(seat_cards(banner.get("sections", []), narrow, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, Kit.px(1.1), Kit.px(1.1), Kit.px(1.1), Kit.px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, Kit.px(2.0), Kit.px(1.4), Kit.px(2.0), Kit.px(1.7)))
	plate.add_child(column)
	var corners := Corners.new()
	corners.narrow = narrow
	plate.add_child(corners)
	return UpdateKit.plate_reveal(plate, still)
