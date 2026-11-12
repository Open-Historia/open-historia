extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const GROUND := Color("#0e1418")
const CARD := Color("#151d22")
const ACCENT := Color("#2bc1f3")
const INK := Color("#eef3f5")
const SOFT := Color(238 / 255.0, 243 / 255.0, 245 / 255.0, 0.7)
const FAINT := Color(238 / 255.0, 243 / 255.0, 245 / 255.0, 0.32)
const FACE := "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif"
const LINE := Color(238 / 255.0, 243 / 255.0, 245 / 255.0, 0.12)
const BAR := Color(238 / 255.0, 243 / 255.0, 245 / 255.0, 0.2)
const BAR_SOFT := Color(238 / 255.0, 243 / 255.0, 245 / 255.0, 0.11)
const SLATE := Color("#1d272d")
const PHONE := Color("#17171a")
const PHONE_EDGE := Color("#3a3a40")
const PHONE_SCREEN := Color("#0b0b0d")
const MARK_INK := Color("#0b1a20")
const HEART := "M0 -3.2a3.2 3.2 0 0 1 5.6 -2 3.2 3.2 0 0 1 5.6 2c0 3.4 -5.6 7 -5.6 7s-5.6 -3.6 -5.6 -7z"
const QUOTE := "M0 0h4v4c0 2.4-1.2 3.8-4 4.6M7 0h4v4c0 2.4-1.2 3.8-4 4.6"
const VOICES := [[-40.0, -30.0], [30.0, -52.0], [55.0, 20.0], [-62.0, 34.0], [8.0, 60.0], [-10.0, -4.0]]
const RISING := [[600.0, 150.0, 0], [640.0, 170.0, 1], [700.0, 140.0, 2], [740.0, 175.0, 3], [660.0, 120.0, 4]]
const SHARES := [0.72, 0.4, 0.88, 0.55]
const LIKES := 1204
const LIKE_EDGE := Color(238 / 255.0, 243 / 255.0, 245 / 255.0, 0.22)


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func accent_alpha(alpha: float) -> Color:
	return Color(ACCENT.r, ACCENT.g, ACCENT.b, alpha)


static func ink_alpha(alpha: float) -> Color:
	return Color(INK.r, INK.g, INK.b, alpha)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": ACCENT, "border": ACCENT, "radius": 999.0, "ink": Color("#06171d"), "font": FACE, "weight": 800, "spacing": 0.01},
		"arrow": {"bg": accent_alpha(0.08), "border": ACCENT, "radius": 999.0, "ink": ACCENT},
		"dot": {"on": ACCENT, "off": ink_alpha(0.26), "radius": 999.0},
		"skip": {"ink": SOFT, "font": FACE, "spacing": 0.01},
	}


static func mark(size_px: float, still: bool, delay := 260.0) -> Control:
	var s := Scene.new(Rect2(0, 0, 32, 32), "meet", true)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.path(root, "M6 3h20a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H13l-6 5v-5H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z", {"fill": ACCENT})
	s.path(root, "M12 21h8l-1.2-7.5h-5.6z", {"fill": MARK_INK})
	s.path(root, "M9.5 13.5h13", {"fill": null, "stroke": MARK_INK, "cap": "round", "width": 1.8})
	s.circle(root, 16, 9, 2, {"fill": MARK_INK})
	var holder := UpdateKit.Riser.new()
	holder.custom_minimum_size = Vector2(size_px, size_px)
	holder.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(s)
	if not still:
		holder.play("ohUpdTurn", 800.0, delay)
	return holder


static func _post(s: Scene, parent: Scene.Shape, x: float, y: float, width := 250.0, lines := 3, accent := false, quote := false) -> void:
	var post := s.group(parent, {"offset": Vector2(x, y)})
	s.rect(post, 0, 0, width, 112.0 if quote else 70.0, {"fill": CARD, "rx": 10.0, "stroke": LINE})
	s.circle(post, 20, 20, 10, {"fill": accent_alpha(0.2) if accent else SLATE, "stroke": ACCENT if accent else LINE})
	s.rect(post, 38, 12, 70, 6, {"fill": INK, "opacity": 0.85, "rx": 3.0})
	s.rect(post, 114, 13, 46, 4, {"fill": BAR_SOFT, "rx": 2.0})
	s.rect(post, 38, 23, 54, 4, {"fill": BAR, "rx": 2.0})
	for at in range(lines):
		s.rect(post, 38, 36.0 + float(at) * 9.0, width * 0.45 if at == lines - 1 else width - 50.0, 4.5, {"fill": BAR, "rx": 2.2})
	if quote:
		s.rect(post, 38, 64, width - 50.0, 38, {"fill": null, "rx": 7.0, "stroke": ink_alpha(0.22)})
		s.circle(post, 49, 74, 5, {"fill": SLATE, "stroke": ACCENT})
		s.rect(post, 59, 72, 44, 4, {"fill": INK, "opacity": 0.7, "rx": 2.0})
		s.rect(post, 46, 85, width - 80.0, 3.5, {"fill": BAR_SOFT, "rx": 1.7})
		s.rect(post, 46, 92, (width - 80.0) * 0.6, 3.5, {"fill": BAR_SOFT, "rx": 1.7})


static func feed(still: bool, narrow: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 220), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 800, 220, {"fill": GROUND})
	var globe := s.group(root, {"offset": Vector2(150, 112)})
	s.circle(globe, 0, 0, 92, {"fill": null, "stroke": accent_alpha(0.35), "width": 1.4})
	var tilts := [-60.0, -30.0, 0.0, 30.0, 60.0]
	for at in range(tilts.size()):
		var rx := absf(cos(deg_to_rad(float(tilts[at])))) * 92.0
		if rx == 0.0:
			rx = 1.0
		s.ellipse(globe, 0, 0, rx, 92, {"fill": null, "stroke": accent_alpha(0.2), "width": 1.0, "dash": [600], "anims": [Scene.motion("ohUpdDraw", 1800.0, 200.0 + float(at) * 160.0, "cubic-bezier(0.3, 0, 0.2, 1)", {"length": 600.0})]})
	var latitudes := [-50.0, -20.0, 20.0, 50.0]
	for at in range(latitudes.size()):
		var lat := deg_to_rad(float(latitudes[at]))
		s.line(globe, -cos(lat) * 92.0, sin(lat) * 92.0, cos(lat) * 92.0, sin(lat) * 92.0, {"stroke": accent_alpha(0.16), "width": 1.0, "dash": [400], "anims": [Scene.motion("ohUpdDraw", 1600.0, 500.0 + float(at) * 120.0, "cubic-bezier(0.3, 0, 0.2, 1)", {"length": 400.0})]})
	for at in range(VOICES.size()):
		var voice: Array = VOICES[at]
		var point := s.group(globe, {"offset": Vector2(float(voice[0]), float(voice[1]))})
		s.circle(point, 0, 0, 5, {"fill": null, "stroke": ACCENT, "width": 1.4, "origin": Vector2.ZERO, "anims": [Scene.forever("ohUpdRing", 2400.0, float(at) * 400.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")]})
		s.circle(point, 0, 0, 2.6, {"fill": ACCENT})
	var phone := s.group(root, {"offset": Vector2(300.0 if narrow else 320.0, 0.0)})
	s.rect(phone, -16, 6, 282, 250, {"fill": PHONE, "rx": 32.0, "stroke": PHONE_EDGE, "width": 1.5})
	s.rect(phone, -8, 13, 266, 236, {"fill": PHONE_SCREEN, "rx": 25.0})
	s.rect(phone, 97, 20, 56, 12, {"fill": Color.BLACK, "rx": 6.0})
	var screen := s.group(phone)
	screen.clip = UpdateKit.rounded(Rect2(-6, 40, 262, 200), 20.0)
	var scroll := s.group(screen, {"anims": [Scene.forever("ohRostraScroll", 16000.0, 900.0, "linear", {"scroll": -282.0})]})
	for offset in [0.0, 282.0]:
		_post(s, scroll, 0.0, offset + 44.0, 250.0, 3, true)
		_post(s, scroll, 0.0, offset + 122.0, 250.0, 2, false, true)
		_post(s, scroll, 0.0, offset + 242.0, 250.0, 3)
	for entry in RISING:
		var rising: Array = entry
		var at: int = rising[2]
		var spot := s.group(root, {"offset": Vector2(float(rising[0]), float(rising[1]))})
		var lift := {"opacity": 0.5 if at % 2 == 1 else 0.85} if still else {"anims": [Scene.forever("ohRostraRise", 3200.0 + float(at) * 300.0, float(at) * 650.0, "cubic-bezier(0.2, 0.6, 0.4, 1)")]}
		var shape := s.group(spot, lift)
		if at % 2 == 0:
			s.path(shape, HEART, {"fill": ACCENT})
		else:
			s.path(shape, QUOTE, {"fill": null, "stroke": INK, "cap": "round", "width": 1.8})
	var compose := s.group(root, {"offset": Vector2(600, 38)})
	s.rect(compose, 0, 0, 176, 40, {"fill": CARD, "rx": 20.0, "stroke": accent_alpha(0.45)})
	s.rect(compose, 16, 17.5, 86, 5, {"fill": BAR, "rx": 2.5, "origin": Vector2(16, 20), "anims": [Scene.forever("ohRostraType", 2600.0, 600.0, "cubic-bezier(0.4, 0, 0.6, 1)")]})
	s.rect(compose, 106, 13, 1.6, 14, {"fill": ACCENT, "anims": [Scene.forever("ohRostraCaret", 1000.0, 0.0)]})
	s.rect(compose, 124, 8, 44, 24, {"fill": ACCENT, "rx": 12.0, "anims": [Scene.forever("ohUpdPulse", 1800.0, 0.0, "cubic-bezier(0.4, 0, 0.6, 1)")]})
	return s


static func desk(still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 220), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var root: Scene.Shape = s.root
	s.rect(root, 0, 0, 800, 220, {"fill": GROUND})
	var panel := s.group(root, {"offset": Vector2(250, 18)})
	s.rect(panel, 0, 0, 300, 190, {"fill": CARD, "rx": 14.0, "stroke": LINE})
	var slide := {"anims": [Scene.forever("ohRostraSlide", 6000.0, 800.0, "cubic-bezier(0.6, 0, 0.3, 1)", {"slide": 96.0})]}
	if still:
		slide["offset"] = Vector2(96, 0)
	var marker := s.group(panel, slide)
	s.rect(marker, 14, 12, 88, 28, {"fill": Color("#0b0f12"), "rx": 8.0, "stroke": ink_alpha(0.3)})
	var spark := s.group(panel, {"offset": Vector2(34, 18)})
	s.path(spark, "M8 1l1.4 3.6L13 6l-3.6 1.1L8 11 6.6 7.1 3 6l3.6-1.4z", {"fill": null, "stroke": INK, "join": "round", "width": 1.4})
	s.rect(spark, 20, 4, 34, 4.5, {"fill": INK, "opacity": 0.7, "rx": 2.0})
	var sheet := s.group(panel, {"offset": Vector2(128, 17)})
	s.rect(sheet, 1, 0, 12, 15, {"fill": null, "rx": 2.0, "stroke": INK, "width": 1.4})
	s.path(sheet, "M4 5h6M4 8.5h6M4 12h3.5", {"fill": null, "stroke": INK, "cap": "round", "width": 1.2})
	s.rect(sheet, 20, 5, 38, 4.5, {"fill": INK, "opacity": 0.7, "rx": 2.0})
	s.line(panel, 0, 52, 300, 52, {"stroke": LINE})
	for at in range(SHARES.size()):
		var share: float = SHARES[at]
		var row := s.group(panel, {"offset": Vector2(16, 64.0 + float(at) * 31.0)})
		s.rect(row, 0, 0, 268, 25, {"fill": SLATE, "rx": 6.0})
		s.rect(row, 10, 6, 90.0 + float(at) * 14.0, 4.5, {"fill": INK, "opacity": 0.7, "rx": 2.0})
		s.rect(row, 10, 15, 180, 4, {"fill": BAR_SOFT, "rx": 2.0})
		s.rect(row, 10, 15, 180.0 * share, 4, {"fill": ACCENT, "rx": 2.0, "origin": Vector2(10, 17), "anims": [Scene.motion("ohUpdGrow", 1400.0, 600.0 + float(at) * 220.0, "cubic-bezier(0.3, 0, 0.2, 1)")]})
		s.circle(row, 250, 12.5, 5, {"fill": null, "stroke": ACCENT if at == 2 else ink_alpha(0.3), "width": 1.4})
	var phone := s.group(root, {"offset": Vector2(620, 46)})
	s.rect(phone, 0, 0, 68, 120, {"fill": PHONE, "rx": 14.0, "stroke": PHONE_EDGE, "width": 1.2})
	s.rect(phone, 4, 4, 60, 112, {"fill": PHONE_SCREEN, "rx": 10.0})
	s.rect(phone, 25, 8, 18, 5, {"fill": Color.BLACK, "rx": 2.5})
	s.rect(phone, 23, 111, 22, 2.5, {"fill": ink_alpha(0.6), "rx": 1.25})
	var place := s.group(phone, {"offset": Vector2(6, 30)})
	var lit := s.group(place, {"anims": [Scene.motion("ohUpdStamp", 900.0, 1600.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")]})
	s.path(lit, "M10 2h36a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H24l-11 9v-9h-3a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z", {"fill": ACCENT})
	s.path(lit, "M21 34h14l-2-12h-10z", {"fill": MARK_INK})
	s.path(lit, "M17 22h22", {"fill": null, "stroke": MARK_INK, "cap": "round", "width": 2.6})
	s.circle(lit, 28, 14, 3, {"fill": MARK_INK})
	var dock := s.group(root, {"offset": Vector2(70, 150)})
	s.rect(dock, 0, 0, 138, 44, {"fill": CARD, "rx": 12.0, "stroke": LINE})
	for at in range(3):
		var props := {"fill": accent_alpha(0.2) if at == 2 else SLATE, "rx": 8.0, "stroke": ACCENT if at == 2 else LINE}
		if at == 2:
			props["anims"] = [Scene.forever("ohUpdPulse", 2000.0, 0.0, "cubic-bezier(0.4, 0, 0.6, 1)")]
		s.rect(dock, 8.0 + float(at) * 44.0, 6, 36, 32, props)
	return s


class Like extends Button:
	var still := false
	var likes := LIKES
	var liked := false
	var heart_box: UpdateKit.Riser
	var heart_scene: Scene
	var heart: Scene.Shape
	var count: Label

	static func grouped(number: int) -> String:
		var digits := str(absi(number))
		var out := ""
		while digits.length() > 3:
			out = "," + digits.right(3) + out
			digits = digits.left(digits.length() - 3)
		return ("-" if number < 0 else "") + digits + out

	func _init() -> void:
		focus_mode = Control.FOCUS_NONE
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND

	func _ready() -> void:
		var row := UpdateKit.hbox(roundi(UpdateKit.px(0.35)))
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		heart_box = UpdateKit.Riser.new()
		heart_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		heart_box.custom_minimum_size = Vector2(16, 16)
		heart_box.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		heart_scene = Scene.new(Rect2(-1, -7, 13.2, 15), "meet", true)
		heart_box.add_child(heart_scene)
		heart = heart_scene.path(heart_scene.root, HEART, {"fill": null, "stroke": SOFT, "width": 1.2})
		row.add_child(heart_box)
		count = UpdateKit.text(grouped(likes), UpdateKit.px(0.78), SOFT, FACE, 700)
		count.autowrap_mode = TextServer.AUTOWRAP_OFF
		count.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(count)
		add_child(row)
		_style()
		pressed.connect(like)
		count.minimum_size_changed.connect(_fit)
		_fit()

	func _fit() -> void:
		var inner := Vector2(16.0 + UpdateKit.px(0.35) + count.get_combined_minimum_size().x, maxf(16.0, count.get_combined_minimum_size().y))
		custom_minimum_size = inner + Vector2(UpdateKit.px(0.7) * 2.0 + 2.0, UpdateKit.px(0.3) * 2.0 + 2.0)

	func _style() -> void:
		var style := UpdateKit.box(Color(14 / 255.0, 20 / 255.0, 24 / 255.0, 0.82), ACCENT if liked else LIKE_EDGE, 999.0, 1, Vector4(UpdateKit.px(0.7), UpdateKit.px(0.3), UpdateKit.px(0.7), UpdateKit.px(0.3)))
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
			add_theme_stylebox_override(state, style)
		var ink := ACCENT if liked else SOFT
		count.add_theme_color_override("font_color", ink)
		heart.stroke = ink
		if liked:
			heart_scene.set_fill(heart, ACCENT)
		heart_scene.redraw()

	func like() -> void:
		liked = true
		likes += 1
		count.text = grouped(likes)
		_style()
		if still:
			return
		var curve := CubicBezier.named("cubic-bezier(0.3, 0, 0.3, 1)")
		var box := heart_box
		CubicBezier.animate(box, func(t: float) -> void:
			if not is_instance_valid(box):
				return
			var zoom := 1.0
			var rise := 0.0
			if t < 0.35:
				var u := curve.at(t / 0.35)
				zoom = lerpf(1.0, 1.3, u)
				rise = lerpf(0.0, -8.0, u)
			else:
				var v := curve.at((t - 0.35) / 0.65)
				zoom = lerpf(1.3, 1.0, v)
				rise = lerpf(-8.0, 0.0, v)
			box.zoom = zoom
			box.lift = rise
			box.queue_sort(), 420.0, 0.0, "linear", false)


static func feed_stage(still: bool, narrow: bool) -> Control:
	var stage := Control.new()
	stage.mouse_filter = Control.MOUSE_FILTER_PASS
	stage.clip_contents = true
	stage.add_child(feed(still, narrow))
	var like := Like.new()
	like.still = still
	like.anchor_left = 1.0
	like.anchor_right = 1.0
	like.anchor_top = 1.0
	like.anchor_bottom = 1.0
	like.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	like.grow_vertical = Control.GROW_DIRECTION_BEGIN
	like.offset_right = -px(0.8)
	like.offset_bottom = -px(0.7)
	stage.add_child(like)
	return stage


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var is_desk := str(banner.get("scene", "")) == "desk"
	var plate := UpdateKit.plate({"background": GROUND, "border": accent_alpha(0.28), "radius": 14.0, "padding": Vector4(1, 1, 1, 1)}, still)
	UpdateKit.brackets(plate, ACCENT, px(0.7), px(1.4), 1.5, true)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(10.5) if narrow else ShellFonts.clamp_vw(11.5, 24.0, 15.0, width), 2.0, ACCENT)
	holder.add_child(desk(still) if is_desk else feed_stage(still, narrow))
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.hbox(roundi(px(0.75) if narrow else px(1.0)))
	head.alignment = BoxContainer.ALIGNMENT_BEGIN
	head.add_child(mark(38.0 if narrow else 48.0, still))
	var words := UpdateKit.vbox(0)
	words.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	words.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	words.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.78), ACCENT, FACE, 700, false, 0.16, true))
	words.add_child(UpdateKit.gap(px(0.15)))
	var title := UpdateKit.para(str(banner.get("title", "")), px(2.0) if narrow else ShellFonts.clamp_vw(2.2, 5.5, 3.1, width), INK, FACE, 900, false, 1.04, -0.01)
	words.add_child(UpdateKit.reveal(title, 380.0, still, "ohUpdFade", 500.0))
	if not str(banner.get("subtitle", "")).is_empty():
		words.add_child(UpdateKit.gap(px(0.25)))
		words.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.02), SOFT, FACE))
	head.add_child(words)
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.98), SOFT, FACE, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(FAINT, UpdateKit.icon_rect("book" if is_desk else "people", 18, ACCENT)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), ACCENT, SOFT, {"background": accent_alpha(0.04), "border": accent_alpha(0.18), "radius": 12.0}, FACE, false, 520.0, still, 110.0, 1 if narrow else 2))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.1), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.4), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
