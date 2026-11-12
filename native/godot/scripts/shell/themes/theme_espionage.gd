extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const NIGHT := Color("#0c1115")
const STREET := Color("#1a252d")
const BLOCK := Color("#131b21")
const PAPER := Color("#e8e2d0")
const PAPER_SOFT := Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.74)
const RED := Color("#c8483a")
const LAMP := Color("#e0a83a")
const TYPE := "ui-monospace, \"Courier New\", Consolas, monospace"
const CHANGE_MS := 3800.0
const SAFEHOUSE := Vector2(92, 164)
const ORDERS := [
	{"key": "collect", "x": 640.0, "y": 58.0, "path": "M92 164 L92 120 L250 120 L250 70 L470 70 L470 58 L640 58"},
	{"key": "sabotage", "x": 690.0, "y": 168.0, "path": "M92 164 L330 164 L330 196 L560 196 L560 168 L690 168"},
	{"key": "recruit", "x": 420.0, "y": 36.0, "path": "M92 164 L170 164 L170 92 L340 92 L340 36 L420 36"},
	{"key": "assassinate", "x": 520.0, "y": 124.0, "path": "M92 164 L250 164 L250 124 L520 124"},
]
const BLOCKS := [[20, 18, 130, 78], [180, 18, 140, 54], [360, 52, 90, 50], [500, 18, 120, 34], [660, 82, 120, 64], [20, 186, 200, 30], [270, 136, 210, 44], [600, 196, 180, 24], [116, 96, 40, 52], [520, 140, 30, 40]]
const ORDER_KEYS := ["collect", "sabotage", "recruit", "assassinate"]
const ORDER_WORDS := {"collect": "Collect", "sabotage": "Sabotage", "recruit": "Recruit", "assassinate": "Assassinate"}
const VERDICT_KEYS := ["silent", "talked"]
const VERDICT_WORDS := {"silent": "Said nothing", "talked": "Talked"}


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": RED, "border": RED, "radius": 2.0, "ink": PAPER, "font": TYPE, "weight": 700, "spacing": 0.08, "caps": true},
		"arrow": {"bg": Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.05), "border": PAPER, "radius": 2.0, "ink": PAPER},
		"dot": {"on": RED, "off": Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.28), "radius": 1.0},
		"skip": {"ink": PAPER, "font": TYPE, "spacing": 0.06},
	}


class Board extends Control:
	var still := false
	var narrow := false
	var custody := false
	var value := ""
	var chosen := false
	var scene: Scene
	var marks := {}
	var route: Scene.Shape
	var ring: Scene.Shape
	var safehouse: Scene.Shape
	var stamp_holder: Control
	var buttons := {}

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		clip_contents = true

	func options() -> Array:
		return VERDICT_KEYS if custody else ORDER_KEYS

	func words() -> Dictionary:
		return VERDICT_WORDS if custody else ORDER_WORDS

	func _ready() -> void:
		value = str(options()[0])
		scene = Scene.new(Rect2(0, 0, 800, 220), "slice", still)
		scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(scene)
		if custody:
			_dossier()
			stamp_holder = Control.new()
			stamp_holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
			stamp_holder.anchor_left = 0.52
			stamp_holder.anchor_right = 0.52
			stamp_holder.anchor_top = 0.68 if narrow else 0.6
			stamp_holder.anchor_bottom = stamp_holder.anchor_top
			add_child(stamp_holder)
			_stamp()
		else:
			_night()
		var keys := HFlowContainer.new()
		keys.mouse_filter = Control.MOUSE_FILTER_IGNORE
		keys.add_theme_constant_override("h_separation", roundi(UpdateKit.px(0.3)))
		keys.add_theme_constant_override("v_separation", roundi(UpdateKit.px(0.3)))
		keys.anchor_top = 1.0
		keys.anchor_bottom = 1.0
		keys.anchor_right = 1.0
		keys.offset_left = UpdateKit.px(0.5) if narrow else UpdateKit.px(0.7)
		keys.offset_right = -UpdateKit.px(0.5) if narrow else 0.0
		keys.offset_bottom = -UpdateKit.px(0.6)
		keys.offset_top = -UpdateKit.px(0.6)
		keys.grow_vertical = Control.GROW_DIRECTION_BEGIN
		add_child(keys)
		for key in options():
			var button := Button.new()
			button.focus_mode = Control.FOCUS_NONE
			button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			button.pressed.connect(func() -> void: pick(str(key)))
			keys.add_child(button)
			buttons[str(key)] = button
		_style_keys()
		if not still:
			var timer := Timer.new()
			timer.wait_time = CHANGE_MS / 1000.0
			timer.autostart = true
			timer.timeout.connect(func() -> void:
				if not chosen:
					var list := options()
					_show(str(list[(list.find(value) + 1) % list.size()])))
			add_child(timer)

	func pick(key: String) -> void:
		chosen = true
		_show(key)

	func _show(key: String) -> void:
		value = key
		if custody:
			_stamp()
		else:
			_route()
		_style_keys()

	func _night() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		s.rect(root, 0, 0, 800, 220, {"fill": NIGHT})
		for at in range(9):
			s.line(root, at * 100 - 8, 0, at * 100 - 8, 220, {"stroke": STREET, "width": 5.0})
		for y in [10.0, 70.0, 124.0, 168.0, 208.0]:
			s.line(root, 0, y, 800, y, {"stroke": STREET, "width": 5.0})
		for block in BLOCKS:
			s.rect(root, float(block[0]), float(block[1]), float(block[2]), float(block[3]), {"fill": BLOCK})
		for at in range(22):
			s.rect(root, 30 + ((at * 137) % 730), 24 + ((at * 59) % 170), 4, 3, {"fill": LAMP, "opacity": 0.5, "anims": [Scene.forever("ohUpdTwinkle", 2400.0 + (at % 5) * 500.0, float((at * 370) % 2000))]})
		for entry in ORDERS:
			var order: Dictionary = entry
			var holder := s.group(root, {"offset": Vector2(float(order["x"]), float(order["y"])), "opacity": 1.0 if str(order["key"]) == value else 0.35})
			_mark(holder, str(order["key"]))
			marks[str(order["key"])] = holder
		_route()

	func _mark(parent: Scene.Shape, kind: String) -> void:
		var s := scene
		match kind:
			"collect":
				s.rect(parent, -7, -9, 14, 18, {"fill": PAPER})
				s.path(parent, "M-4 -4h8M-4 0h8M-4 4h5", {"stroke": NIGHT, "width": 1.2})
			"sabotage":
				s.rect(parent, -11, -2, 22, 12, {"fill": PAPER})
				s.rect(parent, 4, -14, 5, 14, {"fill": PAPER})
				s.path(parent, "M-8 -2l4-6 4 6", {"fill": PAPER})
			"recruit":
				s.circle(parent, 0, -5, 5, {"fill": PAPER})
				s.path(parent, "M-9 9c0-6 4-9 9-9s9 3 9 9z", {"fill": PAPER})
			_:
				s.circle(parent, 0, 0, 9, {"fill": null, "stroke": PAPER, "width": 1.6})
				s.path(parent, "M0 -13v8M0 5v8M-13 0h8M5 0h8", {"stroke": PAPER, "width": 1.6})

	func _route() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		var active: Dictionary = ORDERS[0]
		for entry in ORDERS:
			if str((entry as Dictionary)["key"]) == value:
				active = entry
		for key in marks.keys():
			var holder: Scene.Shape = marks[key]
			holder.opacity = 1.0 if key == str(active["key"]) else 0.35
		if route:
			s.remove(root, route)
		if ring:
			s.remove(root, ring)
		route = s.path(root, str(active["path"]), {"fill": null, "stroke": RED, "dash": [6, 5], "join": "round", "width": 2.4, "dash_offset": 0.0, "anims": [Scene.forever("ohUpdDraw", 14000.0, 0.0, "linear", {"length": 990.0})]})
		ring = s.group(root, {"offset": Vector2(float(active["x"]), float(active["y"]))})
		s.circle(ring, 0, 0, 16, {"fill": null, "stroke": RED, "width": 2.0, "anims": [Scene.forever("ohUpdRing", 1700.0, 1500.0)]})
		if not safehouse:
			safehouse = s.group(root, {"offset": SAFEHOUSE})
			s.rect(safehouse, -7, -7, 14, 14, {"fill": LAMP})
			s.rect(safehouse, -2.5, -2.5, 5, 5, {"fill": NIGHT})
		root.children.erase(safehouse)
		root.children.append(safehouse)

	func _dossier() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		s.rect(root, 0, 0, 800, 220, {"fill": NIGHT})
		var lamp := s.group(root, {"origin": Vector2(400, 0), "anims": [Scene.forever("ohUpdSway", 5200.0, 0.0, "cubic-bezier(0.45, 0, 0.55, 1)")]})
		s.line(lamp, 400, 0, 400, 26, {"stroke": PAPER_SOFT, "width": 1.5})
		s.path(lamp, "M384 26h32l-6 12h-20z", {"fill": LAMP})
		s.path(lamp, "M390 38 L300 220 L500 220 L410 38 Z", {"fill": LAMP, "opacity": 0.08})
		var paper := s.group(root, {"css": [["translate", 250.0, 46.0], ["rotate", -3.0]]})
		s.rect(paper, 0, 0, 300, 160, {"fill": PAPER})
		s.rect(paper, 18, 18, 52, 64, {"fill": null, "stroke": NIGHT, "width": 1.2})
		s.circle(paper, 44, 40, 11, {"fill": NIGHT, "opacity": 0.75})
		s.path(paper, "M24 82c0-14 9-20 20-20s20 6 20 20z", {"fill": NIGHT, "opacity": 0.75})
		var rows := [22.0, 38.0, 54.0, 70.0]
		for at in range(rows.size()):
			s.rect(paper, 88, rows[at], 150 - at * 22, 8, {"fill": NIGHT, "origin": "left", "anims": [Scene.motion("ohUpdGrow", 420.0, 300.0 + at * 260.0)]})
		for y in [100.0, 114.0, 128.0, 142.0]:
			s.line(paper, 18, y, 282, y, {"stroke": NIGHT, "stroke_opacity": 0.35, "width": 1.0})

	func _stamp() -> void:
		for child in stamp_holder.get_children():
			stamp_holder.remove_child(child)
			child.queue_free()
		var mark := PanelContainer.new()
		mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
		mark.add_theme_stylebox_override("panel", UpdateKit.box(Color(0, 0, 0, 0), RED, 3.0, 2, Vector4(UpdateKit.px(0.7) + 2.0, UpdateKit.px(0.25) + 2.0, UpdateKit.px(0.7) + 2.0, UpdateKit.px(0.25) + 2.0)))
		var words_label := UpdateKit.text("Identity unknown" if value == "silent" else "Identified", UpdateKit.px(0.78) if narrow else UpdateKit.px(0.95), RED, TYPE, 700, false, 0.12, true)
		words_label.autowrap_mode = TextServer.AUTOWRAP_OFF
		mark.add_child(words_label)
		stamp_holder.add_child(mark)
		var centre := func() -> void: mark.position = -mark.size * 0.5
		mark.resized.connect(centre)
		centre.call()
		UpdateKit.stamp(mark, 520.0, 260.0, still)

	func _style_keys() -> void:
		var labels := words()
		for key in buttons.keys():
			var button: Button = buttons[key]
			var on: bool = key == value
			var pad := UpdateKit.px(0.5) if narrow else UpdateKit.px(0.8)
			var style := UpdateKit.box(RED if on else Color(12 / 255.0, 17 / 255.0, 21 / 255.0, 0.82), RED if on else Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.45), 2.0, 1, Vector4(pad, 0, pad, 0))
			for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
				button.add_theme_stylebox_override(state, style)
			for child in button.get_children():
				button.remove_child(child)
				child.queue_free()
			var caption := UpdateKit.text(str(labels[key]), UpdateKit.px(0.66) if narrow else UpdateKit.px(0.76), PAPER, TYPE, 700, false, 0.06, true)
			caption.autowrap_mode = TextServer.AUTOWRAP_OFF
			caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			caption.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			button.add_child(caption)
			var want := caption.get_combined_minimum_size()
			button.custom_minimum_size = Vector2(want.x + pad * 2.0 + 2.0, UpdateKit.px(2.0))
			caption.minimum_size_changed.connect(func() -> void:
				var again := caption.get_combined_minimum_size()
				button.custom_minimum_size = Vector2(again.x + pad * 2.0 + 2.0, UpdateKit.px(2.0)))


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var custody := str(banner.get("scene", "")) == "custody"
	var plate := UpdateKit.plate({"background": NIGHT, "border": Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.22), "radius": 3.0}, still)
	UpdateKit.brackets(plate, RED, px(0.7), px(1.5), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(12.0) if narrow else ShellFonts.clamp_vw(13.0, 27.0, 17.0, width), 3.0, RED)
	var board := Board.new()
	board.still = still
	board.narrow = narrow
	board.custody = custody
	holder.add_child(board)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.76), RED, TYPE, 700, false, 0.22, true))
	head.add_child(UpdateKit.gap(px(0.25)))
	head.add_child(UpdateKit.para(str(banner.get("title", "")), px(1.9) if narrow else ShellFonts.clamp_vw(2.1, 5.5, 3.0, width), PAPER, TYPE, 700, false, 1.05, 0.02))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.3)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(0.98), LAMP, TYPE))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), PAPER_SOFT, UpdateKit.BASE_FONT, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(PAPER, UpdateKit.icon_rect("eye", 18, RED)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), RED, PAPER_SOFT, {"background": Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.04), "border": Color(232 / 255.0, 226 / 255.0, 208 / 255.0, 0.18), "radius": 2.0}, TYPE, true, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
