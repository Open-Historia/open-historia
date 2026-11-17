extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const GROUND := Color("#11181c")
const GRID := Color("#1b252b")
const LINE := Color("#d6e2e6")
const SOFT := Color(214 / 255.0, 226 / 255.0, 230 / 255.0, 0.72)
const FAINT := Color(214 / 255.0, 226 / 255.0, 230 / 255.0, 0.3)
const YELLOW := Color("#f2b33d")
const COIN := Color("#e8c35a")
const RED := Color("#e2604a")
const KEY_INK := Color("#15130c")
const KEY_GROUND := Color(17 / 255.0, 24 / 255.0, 28 / 255.0, 0.86)
const FACE := "\"Bahnschrift\", \"DIN Alternate\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif"
const FUNDING_KEYS := ["none", "low", "normal", "high"]
const FUNDING_WORDS := {"none": "Off", "low": "Low", "normal": "Normal", "high": "High"}
const FILL_MS := {"none": 0.0, "low": 12000.0, "normal": 8000.0, "high": 5400.0}
const COIN_MS := {"none": 0.0, "low": 3200.0, "normal": 1600.0, "high": 1050.0}
const HOLD_MS := {"none": 3600.0, "low": 13800.0, "normal": 9800.0, "high": 7200.0}
const WALK := ["normal", "high", "none", "low"]
const SPANS := [
	"M120 150 L120 110 L250 110 L250 150",
	"M250 110 Q 325 60 400 110",
	"M400 110 Q 475 60 550 110",
	"M550 110 L680 110 L680 150",
]
const PIERS := [[250.0, 110.0, 150.0], [400.0, 110.0, 150.0], [550.0, 110.0, 150.0]]
const CHECKPOINTS := [0.3, 0.6, 0.9]
const LAYOUT := {
	"wide": {"treasury": Vector2(48, 70), "bar": [120.0, 560.0]},
	"narrow": {"treasury": Vector2(228, 22), "bar": [210.0, 380.0]},
}
const SITES := [[512.0, 70.0], [600.0, 112.0], [690.0, 60.0], [560.0, 160.0], [720.0, 150.0]]
const COAST := "M470 30 C 520 60, 500 90, 560 96 S 640 70, 700 40 L 780 30 M470 200 C 520 170, 600 196, 660 180 S 740 150, 780 170"


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": YELLOW, "border": YELLOW, "radius": 2.0, "ink": KEY_INK, "font": FACE, "weight": 800, "spacing": 0.08, "caps": true},
		"arrow": {"bg": Color(242 / 255.0, 179 / 255.0, 61 / 255.0, 0.08), "border": YELLOW, "radius": 2.0, "ink": YELLOW},
		"dot": {"on": YELLOW, "off": Color(214 / 255.0, 226 / 255.0, 230 / 255.0, 0.28), "radius": 1.0},
		"skip": {"ink": SOFT, "font": FACE, "spacing": 0.08, "caps": true},
	}


class Works extends Control:
	var still := false
	var narrow := false
	var value := "normal"
	var chosen := false
	var scene: Scene
	var buttons := {}
	var keys: HFlowContainer
	var timer: Timer

	static func grid(s: Scene) -> void:
		var root: Scene.Shape = s.root
		s.rect(root, 0, 0, 800, 220, {"fill": GROUND})
		for at in range(41):
			s.line(root, at * 20.0, 0, at * 20.0, 220, {"stroke": GRID, "width": 1.0})
		for at in range(12):
			s.line(root, 0, at * 20.0, 800, at * 20.0, {"stroke": GRID, "width": 1.0})

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		clip_contents = true

	func _ready() -> void:
		_draw_scene()
		keys = HFlowContainer.new()
		keys.mouse_filter = Control.MOUSE_FILTER_IGNORE
		keys.alignment = FlowContainer.ALIGNMENT_END
		keys.add_theme_constant_override("h_separation", roundi(UpdateKit.px(0.3)))
		keys.add_theme_constant_override("v_separation", roundi(UpdateKit.px(0.3)))
		keys.anchor_left = 0.0
		keys.anchor_right = 1.0
		keys.offset_left = UpdateKit.px(0.6)
		keys.offset_right = -(UpdateKit.px(0.6) if narrow else UpdateKit.px(1.1))
		keys.offset_top = UpdateKit.px(0.6) if narrow else UpdateKit.px(1.1)
		add_child(keys)
		for key in FUNDING_KEYS:
			var button := Button.new()
			button.focus_mode = Control.FOCUS_NONE
			button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			button.tooltip_text = str(FUNDING_WORDS[key])
			button.pressed.connect(pick.bind(str(key)))
			keys.add_child(button)
			buttons[str(key)] = button
		_style_keys()
		if not still:
			timer = Timer.new()
			timer.one_shot = true
			timer.timeout.connect(_walk)
			add_child(timer)
			timer.start(float(HOLD_MS[value]) / 1000.0)

	func _walk() -> void:
		if chosen or still:
			return
		value = str(WALK[(WALK.find(value) + 1) % WALK.size()])
		_redraw_scene()
		_style_keys()
		timer.start(float(HOLD_MS[value]) / 1000.0)

	func pick(key: String) -> void:
		chosen = true
		if timer:
			timer.stop()
		value = key
		_redraw_scene()
		_style_keys()

	func _redraw_scene() -> void:
		if scene:
			remove_child(scene)
			scene.queue_free()
		_draw_scene()
		if keys:
			move_child(keys, get_child_count() - 1)

	func _draw_scene() -> void:
		scene = Scene.new(Rect2(0, 0, 800, 220), "slice", still)
		scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		scene.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(scene)
		var s := scene
		var root: Scene.Shape = s.root
		grid(s)
		var fill: float = FILL_MS[value]
		var coin: float = COIN_MS[value]
		var layout: Dictionary = LAYOUT["narrow" if narrow else "wide"]
		var treasury_at: Vector2 = layout["treasury"]
		var bar_at: Array = layout["bar"]
		var bar_x: float = bar_at[0]
		var bar_width: float = bar_at[1]
		s.path(root, "M100 168 C 260 160, 540 176, 700 166", {"fill": null, "stroke": FAINT, "dash": [4, 6], "width": 1.5})
		for at in range(SPANS.size()):
			var props := {"fill": null, "stroke": LINE, "cap": "round", "width": 3.0, "dash": [320], "dash_offset": 320.0 if fill > 0.0 else 0.0}
			if fill > 0.0:
				props["anims"] = [Scene.motion("ohUpdDraw", fill / 4.0, 400.0 + float(at) * fill / 4.0, "linear", {"length": 320.0})]
			s.path(root, str(SPANS[at]), props)
		for pier in PIERS:
			s.line(root, float(pier[0]), float(pier[1]), float(pier[0]), float(pier[2]), {"stroke": SOFT, "width": 2.0})
		var treasury := s.group(root, {"offset": treasury_at})
		s.rect(treasury, -22, 0, 44, 54, {"fill": null, "stroke": COIN, "width": 2.0})
		s.path(treasury, "M-22 14h44", {"fill": null, "stroke": COIN, "width": 1.5})
		if coin > 0.0 and not still:
			for at in range(3):
				s.circle(treasury, 0, -10, 5, {"fill": COIN, "anims": [Scene.forever("ohUpdFall", coin * 1.4, coin * float(at) / 1.6, "cubic-bezier(0.5, 0, 0.9, 0.6)", {"fall": 46.0})]})
		elif coin > 0.0:
			for at in range(3):
				s.circle(treasury, 0, -10, 5, {"fill": COIN})
		var bar := s.group(root, {"offset": Vector2(bar_x, 194)})
		s.rect(bar, 0, 0, bar_width, 10, {"fill": GRID, "stroke": FAINT, "width": 1.0})
		var grow := {"fill": YELLOW, "origin": Vector2(0, 5)}
		if fill > 0.0:
			grow["anims"] = [Scene.motion("ohUpdGrow", fill, 300.0, "linear")]
			s.rect(bar, 0, 0, bar_width, 10, grow)
		else:
			s.rect(bar, 0, 0, bar_width * 0.04, 10, {"fill": YELLOW})
		for index in range(CHECKPOINTS.size()):
			var at: float = CHECKPOINTS[index]
			var mark := s.group(bar, {"offset": Vector2(at * bar_width, 0)})
			s.line(mark, 0, -12, 0, 10, {"stroke": LINE, "width": 1.5})
			var flag := {"fill": LINE}
			if fill > 0.0:
				flag["anims"] = [Scene.motion("ohUpdFade", 400.0, 300.0 + at * fill)]
			else:
				flag["opacity"] = 0.35
			s.path(mark, "M0 -12 L12 -8 L0 -4 Z", flag)
			s.circle(mark, 0, -12, 1.6, {"fill": LINE, "opacity": 1.0 if index == 2 else 0.8})

	func _style_keys() -> void:
		for key in buttons.keys():
			var button: Button = buttons[key]
			var on: bool = key == value
			var pad := UpdateKit.px(0.55) if narrow else UpdateKit.px(0.8)
			var style := UpdateKit.box(YELLOW if on else KEY_GROUND, YELLOW if on else FAINT, 2.0, 1, Vector4(pad, 0, pad, 0))
			for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
				button.add_theme_stylebox_override(state, style)
			for child in button.get_children():
				button.remove_child(child)
				child.queue_free()
			var caption := UpdateKit.text(str(FUNDING_WORDS[key]), UpdateKit.px(0.66) if narrow else UpdateKit.px(0.74), KEY_INK if on else LINE, FACE, 800, false, 0.08, true)
			caption.autowrap_mode = TextServer.AUTOWRAP_OFF
			caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			caption.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			button.add_child(caption)
			var want := caption.get_combined_minimum_size()
			button.custom_minimum_size = Vector2(want.x + pad * 2.0 + 2.0, UpdateKit.px(2.0))
			caption.minimum_size_changed.connect(_fit_key.bind(button, caption, pad))

	func _fit_key(button: Button, caption: Label, pad: float) -> void:
		if not is_instance_valid(caption) or not is_instance_valid(button):
			return
		var again := caption.get_combined_minimum_size()
		button.custom_minimum_size = Vector2(again.x + pad * 2.0 + 2.0, UpdateKit.px(2.0))


static func plans(still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 220), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var root: Scene.Shape = s.root
	Works.grid(s)
	var card := s.group(root, {"css": [["translate", 70.0, 26.0], ["rotate", -2.0]]})
	s.rect(card, 0, 0, 300, 168, {"fill": LINE})
	s.rect(card, 18, 18, 160, 10, {"fill": GROUND})
	var rows := [44.0, 62.0, 80.0, 98.0]
	for at in range(rows.size()):
		s.rect(card, 18, rows[at], 220.0 - float(at) * 30.0, 6, {"fill": GROUND, "opacity": 0.7, "origin": Vector2(18, rows[at] + 3.0), "anims": [Scene.motion("ohUpdGrow", 420.0, 300.0 + float(at) * 240.0)]})
	s.rect(card, 18, 122, 264, 14, {"fill": null, "stroke": GROUND, "width": 1.4})
	s.rect(card, 18, 122, 120, 14, {"fill": YELLOW, "origin": Vector2(18, 129), "anims": [Scene.motion("ohUpdGrow", 1800.0, 1400.0)]})
	for at in [0.3, 0.6, 0.9]:
		s.line(card, 18.0 + 264.0 * at, 118, 18.0 + 264.0 * at, 140, {"stroke": GROUND, "width": 1.4})
	s.path(root, COAST, {"fill": null, "stroke": SOFT, "width": 1.6})
	for at in range(SITES.size()):
		var site: Array = SITES[at]
		var spot := s.group(root, {"offset": Vector2(float(site[0]), float(site[1]))})
		s.circle(spot, 0, 0, 10, {"fill": null, "stroke": YELLOW, "width": 1.6, "origin": Vector2.ZERO, "anims": [Scene.forever("ohUpdRing", 2600.0, float(at) * 520.0)]})
		s.rect(spot, -3.5, -3.5, 7, 7, {"fill": RED if at % 2 == 1 else YELLOW})
	return s


static func plans_stage(still: bool, narrow: bool) -> Control:
	var stage := Control.new()
	stage.mouse_filter = Control.MOUSE_FILTER_IGNORE
	stage.clip_contents = true
	stage.add_child(plans(still))
	var holder := Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.anchor_left = 0.4 if narrow else 0.34
	holder.anchor_right = holder.anchor_left
	holder.anchor_top = 0.58
	holder.anchor_bottom = 0.58
	stage.add_child(holder)
	var mark := PanelContainer.new()
	mark.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mark.add_theme_stylebox_override("panel", UpdateKit.box(Color(0, 0, 0, 0), RED, 2.0, 3, Vector4(UpdateKit.px(0.7) + 2.5, UpdateKit.px(0.2) + 2.5, UpdateKit.px(0.7) + 2.5, UpdateKit.px(0.2) + 2.5)))
	var words := UpdateKit.text("Start", UpdateKit.px(0.78) if narrow else UpdateKit.px(0.95), RED, FACE, 800, false, 0.14, true)
	words.autowrap_mode = TextServer.AUTOWRAP_OFF
	mark.add_child(words)
	holder.add_child(mark)
	var centre := func() -> void: mark.position = -mark.size * 0.5
	mark.resized.connect(centre)
	centre.call()
	UpdateKit.stamp(mark, 520.0, 2600.0, still)
	return stage


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var is_plans := str(banner.get("scene", "")) == "plans"
	var plate := UpdateKit.plate({"background": GROUND, "border": FAINT, "radius": 2.0}, still)
	UpdateKit.brackets(plate, YELLOW, px(0.7), px(1.5), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(12.0) if narrow else ShellFonts.clamp_vw(13.0, 27.0, 17.0, width), 3.0, YELLOW)
	if is_plans:
		holder.add_child(plans_stage(still, narrow))
	else:
		var works := Works.new()
		works.still = still
		works.narrow = narrow
		holder.add_child(works)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.76), YELLOW, FACE, 800, false, 0.22, true))
	head.add_child(UpdateKit.gap(px(0.25)))
	head.add_child(UpdateKit.para(str(banner.get("title", "")), px(1.9) if narrow else ShellFonts.clamp_vw(2.1, 5.5, 3.0, width), LINE, FACE, 800, false, 1.05, 0.02))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.3)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(0.98), YELLOW, FACE))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), SOFT, UpdateKit.BASE_FONT, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(LINE, UpdateKit.icon_rect("wall", 18, YELLOW)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), YELLOW, SOFT, {"background": Color(214 / 255.0, 226 / 255.0, 230 / 255.0, 0.04), "border": FAINT, "radius": 2.0}, FACE, true, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
