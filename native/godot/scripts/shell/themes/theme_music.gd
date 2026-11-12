extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const INK := Color("#101319")
const GOLD := Color("#e2b04a")
const CREAM := Color("#f3e9d2")
const CREAM_SOFT := Color(243 / 255.0, 233 / 255.0, 210 / 255.0, 0.72)
const STAGE := Color("#161a22")
const SERIF := "Georgia, \"Times New Roman\", serif"
const PITCHES := [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98]
const NOTES := [
	{"x": 6.0, "y": 18.0, "size": 96.0, "shape": "eighth", "gold": true, "beat": 4200.0, "tilt": -8.0},
	{"x": 19.0, "y": 48.0, "size": 66.0, "shape": "quarter", "gold": false, "beat": 3600.0, "tilt": 6.0},
	{"x": 31.0, "y": 10.0, "size": 84.0, "shape": "beamed", "gold": false, "beat": 5000.0, "tilt": -4.0},
	{"x": 44.0, "y": 44.0, "size": 108.0, "shape": "sixteenths", "gold": true, "beat": 4600.0, "tilt": 7.0},
	{"x": 58.0, "y": 8.0, "size": 70.0, "shape": "eighth", "gold": false, "beat": 3900.0, "tilt": -10.0},
	{"x": 68.0, "y": 46.0, "size": 90.0, "shape": "quarter", "gold": true, "beat": 4400.0, "tilt": 5.0},
	{"x": 80.0, "y": 14.0, "size": 100.0, "shape": "beamed", "gold": true, "beat": 5200.0, "tilt": -6.0},
	{"x": 90.0, "y": 50.0, "size": 62.0, "shape": "eighth", "gold": false, "beat": 3400.0, "tilt": 9.0},
	{"x": 54.0, "y": 66.0, "size": 56.0, "shape": "quarter", "gold": false, "beat": 3700.0, "tilt": -5.0},
]
const BOB := "cubic-bezier(0.45, 0, 0.55, 1)"

static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": GOLD, "border": GOLD, "radius": 999.0, "ink": INK, "font": SERIF, "italic": true, "spacing": 0.02},
		"arrow": {"bg": Color(226 / 255.0, 176 / 255.0, 74 / 255.0, 0.08), "border": GOLD, "ink": GOLD},
		"dot": {"on": GOLD, "off": Color(226 / 255.0, 176 / 255.0, 74 / 255.0, 0.3)},
		"skip": {"ink": CREAM, "font": SERIF, "italic": true},
	}


class Stage extends Control:
	var still := false
	var narrow := false
	var sound := false
	var scene: Scene
	var notes: Array[Dictionary] = []
	var hovered := -1
	var built := Vector2.ZERO
	static var _tones := {}

	static func tone(frequency: float) -> AudioStreamWAV:
		var key := "%.2f" % frequency
		if _tones.has(key):
			return _tones[key]
		var rate := 44100
		var count := int(1.6 * rate)
		var data := PackedByteArray()
		data.resize(count * 2)
		var ratio := 0.0001 / 0.16
		for index in range(count):
			var t := float(index) / float(rate)
			var level := 0.0001
			if t < 0.008:
				level = 0.0001 + (0.16 - 0.0001) * (t / 0.008)
			elif t < 1.5:
				level = 0.16 * pow(ratio, (t - 0.008) / (1.5 - 0.008))
			var phase := fmod(2.0 * frequency * t + 0.25, 1.0)
			var triangle := 1.0 - 4.0 * absf(phase - 0.5)
			var sample := (sin(TAU * frequency * t) + triangle * 0.22) * level
			data.encode_s16(index * 2, int(clampf(sample, -1.0, 1.0) * 32767.0))
		var stream := AudioStreamWAV.new()
		stream.format = AudioStreamWAV.FORMAT_16_BITS
		stream.mix_rate = rate
		stream.stereo = false
		stream.data = data
		_tones[key] = stream
		return stream

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		clip_contents = true

	func _ready() -> void:
		scene = Scene.new(Rect2(0, 0, 1, 1), "pixels", still)
		scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(scene)
		move_child(scene, 0)
		resized.connect(_rebuild)
		_rebuild()

	func _rebuild() -> void:
		if size.x < 2.0 or size.y < 2.0 or size == built:
			return
		built = size
		scene.root.children.clear()
		scene.view_box = Rect2(Vector2.ZERO, size)
		var staff := scene.group(scene.root, {"transform": Transform2D(0.0, Vector2(size.x / 800.0, size.y / 200.0), 0.0, Vector2.ZERO)})
		for line_index in range(5):
			var y := float(line_index) * 16.0
			var props := {"fill": null, "stroke": GOLD, "width": 1.4, "opacity": 0.28, "origin": {"kind": "view", "at": Vector2.ZERO}}
			if not still:
				props["anims"] = [Scene.forever("ohUpdSway", 6000.0 + line_index * 400.0, line_index * 200.0, BOB)]
			scene.path(staff, "M-40 %s C140 %s 300 %s 420 %s S700 %s 860 %s" % [70.0 + y, 40.0 + y, 110.0 + y, 76.0 + y, 44.0 + y, 84.0 + y], props)
		notes.clear()
		for at in range(NOTES.size()):
			var spec: Dictionary = NOTES[at]
			var side := roundf(float(spec["size"]) * 0.62) if narrow else float(spec["size"])
			var wide := roundf(side * 0.75)
			var fill := GOLD if bool(spec["gold"]) else CREAM
			var left := size.x * float(spec["x"]) / 100.0
			var top := size.y * float(spec["y"]) / 100.0
			var outer := scene.group(scene.root, {"transform": Transform2D(0.0, Vector2(left, top))})
			var bob_props := {"origin": {"kind": "view", "at": Vector2(wide * 0.5, side * 0.5)}}
			var beat := float(spec["beat"])
			if still:
				bob_props["css"] = [["rotate", float(spec["tilt"])]]
			else:
				bob_props["anims"] = [Scene.forever("ohUpdBob", beat, -beat * (float(spec["x"]) / 100.0), BOB, {"tilt": float(spec["tilt"])})]
			var bob := scene.group(outer, bob_props)
			var ring_holder := scene.group(bob, {})
			var strike := scene.group(bob, {"origin": {"kind": "view", "at": Vector2(wide * 0.5, side * 0.5)}, "zoom": 1.0, "transition": {"ms": 160.0, "timing": "cubic-bezier(0.2, 0.7, 0.2, 1)"}})
			var fit := minf(wide / 60.0, side / 80.0)
			var glyph := scene.group(strike, {"transform": Transform2D(0.0, Vector2((wide - 60.0 * fit) * 0.5, (side - 80.0 * fit) * 0.5)) * Transform2D(0.0, Vector2(fit, fit), 0.0, Vector2.ZERO)})
			_shape(glyph, str(spec["shape"]), fill)
			notes.append({"outer": outer, "bob": bob, "ring_holder": ring_holder, "strike": strike, "wide": wide, "side": side, "fill": fill, "pitch": float(PITCHES[at % PITCHES.size()]), "struck": 0})
		scene.redraw()

	func _shape(parent: Scene.Shape, kind: String, fill: Color) -> void:
		var about := func(degrees: float, cx: float, cy: float) -> Transform2D:
			return Transform2D(0.0, Vector2(cx, cy)) * Transform2D(deg_to_rad(degrees), Vector2.ZERO) * Transform2D(0.0, Vector2(-cx, -cy))
		match kind:
			"quarter", "eighth":
				scene.ellipse(parent, 20, 64, 13, 9, {"fill": fill, "transform": about.call(-22.0, 20.0, 64.0)})
				scene.rect(parent, 29.5, 9, 4.5, 56, {"fill": fill, "rx": 1.5})
				if kind == "eighth":
					scene.path(parent, "M33 9 C41 15 52 21 48 40 C46 30 40 26 33 24 Z", {"fill": fill})
			_:
				scene.ellipse(parent, 11, 68, 10, 7, {"fill": fill, "transform": about.call(-22.0, 11.0, 68.0)})
				scene.ellipse(parent, 45, 60, 10, 7, {"fill": fill, "transform": about.call(-22.0, 45.0, 60.0)})
				scene.rect(parent, 18, 14, 4, 54, {"fill": fill})
				scene.rect(parent, 52, 6, 4, 54, {"fill": fill})
				if kind == "sixteenths":
					scene.path(parent, "M18 14 L56 6 L56 12 L18 20 Z M18 26 L56 18 L56 24 L18 32 Z", {"fill": fill})
				else:
					scene.path(parent, "M18 14 L56 6 L56 14 L18 22 Z", {"fill": fill})

	func _note_at(point: Vector2) -> int:
		for index in range(notes.size() - 1, -1, -1):
			var note: Dictionary = notes[index]
			var matrix := scene.chain_matrix([note["outer"], note["bob"]])
			var inside := matrix.affine_inverse() * point
			if Rect2(Vector2.ZERO, Vector2(float(note["wide"]), float(note["side"]))).has_point(inside):
				return index
		return -1

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseMotion:
			_hover(_note_at((event as InputEventMouseMotion).position))
		elif event is InputEventMouseButton:
			var press := event as InputEventMouseButton
			if press.pressed and press.button_index == MOUSE_BUTTON_LEFT:
				var index := _note_at(press.position)
				if index >= 0:
					_play(index)
					accept_event()

	func _notification(what: int) -> void:
		if what == NOTIFICATION_MOUSE_EXIT:
			_hover(-1)

	func _hover(index: int) -> void:
		if index == hovered:
			return
		if hovered >= 0 and hovered < notes.size():
			scene.zoom_to(notes[hovered]["strike"], 1.0)
		hovered = index
		if index >= 0:
			scene.zoom_to(notes[index]["strike"], 1.12)
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if index >= 0 else Control.CURSOR_ARROW

	func _play(index: int) -> void:
		var note: Dictionary = notes[index]
		if sound:
			var player := AudioStreamPlayer.new()
			player.stream = tone(float(note["pitch"]))
			add_child(player)
			player.finished.connect(player.queue_free)
			player.play()
		note["struck"] = int(note["struck"]) + 1
		var side := float(note["side"])
		var holder: Scene.Shape = note["ring_holder"]
		holder.children.clear()
		if not still:
			scene.circle(holder, side * 0.5, side * 0.5, side * 0.5 - 1.0, {"fill": null, "stroke": note["fill"], "width": 2.0, "anims": [Scene.motion("ohUpdRing", 900.0, 0.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")]})
			scene.set_anims(note["strike"], [Scene.motion("ohUpdStrike", 420.0, 0.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")])
		scene.redraw()


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var plate := UpdateKit.plate({"background": INK, "border": Color(226 / 255.0, 176 / 255.0, 74 / 255.0, 0.35), "radius": 16.0}, still)
	UpdateKit.brackets(plate, GOLD, px(0.7), px(1.6), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(11.0) if narrow else ShellFonts.clamp_vw(12.0, 26.0, 16.0, width), 1.0, Color(226 / 255.0, 176 / 255.0, 74 / 255.0, 0.25), STAGE)
	var stage_area := Control.new()
	stage_area.mouse_filter = Control.MOUSE_FILTER_PASS
	var stage := Stage.new()
	stage.still = still
	stage.narrow = narrow
	stage.sound = bool(ctx.get("sound", false))
	stage.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stage_area.add_child(stage)
	var hint := UpdateKit.text("Touch the notes", px(0.78), CREAM_SOFT, SERIF, 400, true)
	hint.autowrap_mode = TextServer.AUTOWRAP_OFF
	hint.size_flags_horizontal = Control.SIZE_SHRINK_END
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hint.anchor_left = 1.0
	hint.anchor_right = 1.0
	hint.anchor_top = 1.0
	hint.anchor_bottom = 1.0
	hint.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hint.offset_right = -px(0.9)
	hint.offset_bottom = -px(0.55)
	stage_area.add_child(hint)
	holder.add_child(stage_area)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	var line: Array[Dictionary] = [UpdateKit.run(UpdateKit.major_line(update), px(0.78), GOLD, SERIF, 400, false, 0.16, false, true)]
	head.add_child(UpdateKit.runs(line))
	head.add_child(UpdateKit.gap(px(0.2)))
	head.add_child(UpdateKit.para(str(banner.get("title", "")), px(2.2) if narrow else ShellFonts.clamp_vw(2.4, 6.0, 3.4, width), CREAM, SERIF, 400, true, 1.05))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.2)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.05), GOLD, SERIF, 400, true))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), CREAM_SOFT, SERIF, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(GOLD, UpdateKit.icon_rect("note", 18, GOLD)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), GOLD, CREAM_SOFT, {"background": Color(243 / 255.0, 233 / 255.0, 210 / 255.0, 0.04), "border": Color(226 / 255.0, 176 / 255.0, 74 / 255.0, 0.2), "radius": 12.0}, SERIF, false, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
