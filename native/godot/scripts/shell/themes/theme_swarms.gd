extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const TABLE := Color("#16211a")
const PAPER := Color("#eadfc4")
const PAPER_SOFT := Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.76)
const BRASS := Color("#d6a83c")
const SERIF := "Georgia, \"Times New Roman\", serif"
const FORM_MS := 4600.0
const BLUE := Color("#33557e")
const RED := Color("#963a2c")
const INK := Color("#5b4a32")
const LAND_BLUE := Color("#e2dcc6")
const LAND_RED := Color("#ead9c1")
const GRID := Color("#d5c6a2")
const SWARMS_WIDE := [Vector2(286, 72), Vector2(300, 156)]
const SWARMS_NARROW := [Vector2(304, 60), Vector2(318, 134)]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": BRASS, "border": BRASS, "radius": 4.0, "ink": TABLE, "font": SERIF, "weight": 700, "spacing": 0.04},
		"arrow": {"bg": Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.06), "border": PAPER, "ink": PAPER},
		"dot": {"on": BRASS, "off": Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.3)},
		"skip": {"ink": PAPER, "font": SERIF, "italic": true},
	}


class CampaignMap extends Control:
	var still := false
	var narrow := false
	var form := "front"
	var chosen := false
	var scene: Scene
	var mine: Array[Scene.Shape] = []
	var spots: Array = []
	var buttons := {}

	static func counters_for(swarms: Array) -> Array:
		var out: Array = []
		for at in range(12):
			var swarm: Vector2 = swarms[0 if at < 6 else 1]
			var place := at % 6
			out.append({
				"front": Vector2(356.0 + float(((at * 37) % 13) - 6), 24.0 + float(at) * 15.6),
				"swarm": Vector2(swarm.x + float((place % 3) - 1) * 21.0, swarm.y + (-8.0 if place < 3 else 8.0)),
				"wait": float((at * 173) % 640),
				"pace": 1050.0 + float((at * 89) % 520),
			})
		return out

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		clip_contents = true

	func _ready() -> void:
		scene = Scene.new(Rect2(0, 0, 800, 220), "slice", still)
		scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(scene)
		_build()
		var keys := UpdateKit.hbox(roundi(UpdateKit.px(0.35)))
		keys.mouse_filter = Control.MOUSE_FILTER_IGNORE
		keys.anchor_top = 1.0
		keys.anchor_bottom = 1.0
		keys.offset_left = UpdateKit.px(0.5) if narrow else UpdateKit.px(0.7)
		keys.offset_bottom = -UpdateKit.px(0.6)
		keys.offset_top = -UpdateKit.px(0.6)
		keys.grow_vertical = Control.GROW_DIRECTION_BEGIN
		add_child(keys)
		for key in ["front", "swarm"]:
			var button := Button.new()
			button.focus_mode = Control.FOCUS_NONE
			button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			button.pressed.connect(func() -> void: pick(key))
			keys.add_child(button)
			buttons[key] = button
		_style_keys()
		if not still:
			var timer := Timer.new()
			timer.wait_time = FORM_MS / 1000.0
			timer.autostart = true
			timer.timeout.connect(func() -> void:
				if not chosen:
					_show("swarm" if form == "front" else "front"))
			add_child(timer)

	func pick(key: String) -> void:
		chosen = true
		_show(key)

	func _show(key: String) -> void:
		form = key
		for at in range(mine.size()):
			var spot: Dictionary = spots[at]
			scene.shift_to(mine[at], spot["swarm"] if form == "swarm" else spot["front"])
		_style_keys()

	func _counter(parent: Scene.Shape, colour: Color, at_point: Vector2, props := {}) -> Scene.Shape:
		var merged := {"offset": at_point}
		for key in props.keys():
			merged[key] = props[key]
		var holder := scene.group(parent, merged)
		scene.rect(holder, -8.5, -6, 17, 12, {"fill": colour, "rx": 1.5, "stroke": PAPER, "width": 1.2})
		scene.path(holder, "M-6 -4 L6 4 M-6 4 L6 -4", {"fill": null, "stroke": PAPER, "cap": "round", "width": 1.1})
		return holder

	func _build() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		s.rect(root, 0, 0, 800, 220, {"fill": LAND_BLUE})
		s.path(root, "M402 0 C382 40 424 72 398 112 S380 172 406 220 L800 220 L800 0 Z", {"fill": LAND_RED})
		for at in range(21):
			s.line(root, at * 40, 0, at * 40, 220, {"stroke": GRID, "width": 0.6})
		for at in range(6):
			s.line(root, 0, at * 40, 800, at * 40, {"stroke": GRID, "width": 0.6})
		s.path(root, "M402 0 C382 40 424 72 398 112 S380 172 406 220", {"fill": null, "stroke": INK, "dash": [7, 4, 2, 4], "width": 1.6})
		for hill in [[120.0, 150.0], [150.0, 162.0], [560.0, 70.0], [590.0, 84.0], [660.0, 160.0], [180.0, 44.0]]:
			s.path(root, "M%s %s l12 -12 l12 12" % [float(hill[0]) - 12.0, hill[1]], {"fill": null, "stroke": INK, "cap": "round", "join": "round", "width": 1.3})
		s.path(root, "M0 196 C80 186 130 206 210 192 S330 170 388 182", {"fill": null, "stroke": "#7d9bb3", "cap": "round", "width": 3.0})
		var compass := s.group(root, {"offset": Vector2(724, 52)})
		s.circle(compass, 0, 0, 22, {"fill": null, "stroke": INK, "width": 1.2})
		s.path(compass, "M0 -20 L5 0 L0 20 L-5 0 Z", {"fill": INK})
		s.path(compass, "M-20 0 L0 -4 L20 0 L0 4 Z", {"fill": null, "stroke": INK, "width": 1.0})
		for at in range(11):
			_counter(root, RED, Vector2(446.0 + float(((at * 29) % 11) - 5), 28.0 + float(at) * 16.4))
		spots = counters_for(SWARMS_NARROW if narrow else SWARMS_WIDE)
		mine.clear()
		for at in range(spots.size()):
			var spot: Dictionary = spots[at]
			var props := {}
			if not still:
				props["transition"] = {"ms": float(spot["pace"]), "delay": float(spot["wait"]), "timing": "cubic-bezier(0.45, 0, 0.25, 1)"}
			mine.append(_counter(root, BLUE, spot["front"], props))

	func _style_keys() -> void:
		for key in buttons.keys():
			var button: Button = buttons[key]
			var on: bool = key == form
			var ink := TABLE if on else PAPER
			var pad := UpdateKit.px(0.6) if narrow else UpdateKit.px(0.9)
			var style := UpdateKit.box(BRASS if on else Color(22 / 255.0, 33 / 255.0, 26 / 255.0, 0.78), BRASS if on else Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.5), 4.0, 1, Vector4(pad, 0, pad, 0))
			for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
				button.add_theme_stylebox_override(state, style)
			for child in button.get_children():
				button.remove_child(child)
				child.queue_free()
			var row := UpdateKit.hbox(roundi(UpdateKit.px(0.3)))
			row.alignment = BoxContainer.ALIGNMENT_CENTER
			row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			row.add_child(UpdateKit.icon_rect("flag" if key == "swarm" else "map", 12 if narrow else 15, ink))
			var caption := UpdateKit.text("Swarm" if key == "swarm" else "Front", UpdateKit.px(0.74) if narrow else UpdateKit.px(0.84), ink, SERIF, 700)
			caption.autowrap_mode = TextServer.AUTOWRAP_OFF
			caption.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
			caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			row.add_child(caption)
			button.add_child(row)
			var want := row.get_combined_minimum_size()
			button.custom_minimum_size = Vector2(want.x + pad * 2.0 + 2.0, UpdateKit.px(2.0))
			caption.minimum_size_changed.connect(func() -> void:
				var again := row.get_combined_minimum_size()
				button.custom_minimum_size = Vector2(again.x + pad * 2.0 + 2.0, UpdateKit.px(2.0)))


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var plate := UpdateKit.plate({"background": TABLE, "border": Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.26), "radius": 8.0}, still)
	UpdateKit.brackets(plate, BRASS, px(0.7), px(1.6), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(12.0) if narrow else ShellFonts.clamp_vw(13.0, 27.0, 17.0, width), 3.0, BRASS)
	var map := CampaignMap.new()
	map.still = still
	map.narrow = narrow
	holder.add_child(map)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	var line: Array[Dictionary] = [UpdateKit.run(UpdateKit.major_line(update), px(0.8), BRASS, SERIF, 400, false, 0.16, false, true)]
	head.add_child(UpdateKit.runs(line))
	head.add_child(UpdateKit.gap(px(0.2)))
	head.add_child(UpdateKit.para(str(banner.get("title", "")), px(2.1) if narrow else ShellFonts.clamp_vw(2.3, 6.0, 3.2, width), PAPER, SERIF, 700, false, 1.05))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.2)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.05), BRASS, SERIF, 400, true))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), PAPER_SOFT, SERIF, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(PAPER, UpdateKit.icon_rect("flag", 18, BRASS)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), BRASS, PAPER_SOFT, {"background": Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.05), "border": Color(234 / 255.0, 223 / 255.0, 196 / 255.0, 0.2), "radius": 6.0}, SERIF, false, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
