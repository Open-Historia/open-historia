extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const GROUND := Color("#0c1317")
const PANEL := Color("#121c22")
const SIGNAL := Color("#2bc1f3")
const WARM := Color("#f2b84b")
const INK := Color("#eef4f7")
const SOFT := Color(238 / 255.0, 244 / 255.0, 247 / 255.0, 0.72)
const FAINT := Color(238 / 255.0, 244 / 255.0, 247 / 255.0, 0.22)
const LINE := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.28)
const WIRE := Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.18)
const DIM := Color(238 / 255.0, 244 / 255.0, 247 / 255.0, 0.1)
const BAR := Color(238 / 255.0, 244 / 255.0, 247 / 255.0, 0.28)
const FACE := "\"Segoe UI\", \"Helvetica Neue\", Arial, system-ui, sans-serif"
const MONO := "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, \"Liberation Mono\", monospace"
const EASE := "cubic-bezier(0.4, 0, 0.2, 1)"
const BREATH := "cubic-bezier(0.4, 0, 0.6, 1)"
const DRAW := "cubic-bezier(0.3, 0, 0.2, 1)"
const TRACES := ["M0 30 H120 L140 50 H260", "M0 196 H90 L110 176 H210", "M800 40 H690 L670 60 H560", "M800 186 H700 L680 206 H600", "M330 0 V24 L350 44", "M470 220 V196 L450 176"]
const PADS := [[260, 50], [210, 176], [560, 60], [600, 206], [350, 44], [450, 176]]
const LIVE := [0.92, 0.7, 0.84, 0.6, 0.76]
const TRIMMED := [0.5, 0.42, 0.62, 0.3, 0.44]
const EVENTS := [40, 72, 96, 130, 158, 190, 214, 250, 282, 308, 340, 372, 398, 430, 462]
const RELATED := [1, 5, 9, 12]
const SCENE_ICON := {"skips": "gear", "memory": "book", "setup": "star"}


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": SIGNAL, "border": SIGNAL, "radius": 4.0, "ink": Color("#03141c"), "font": MONO, "weight": 800, "spacing": 0.06},
		"arrow": {"bg": Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.08), "border": LINE, "radius": 4.0, "ink": SIGNAL},
		"dot": {"on": SIGNAL, "off": FAINT, "radius": 2.0},
		"skip": {"ink": SOFT, "font": MONO, "spacing": 0.06},
	}


static func _loop(name: String, ms: float, delay := 0.0, timing := EASE, vars := {}) -> Dictionary:
	return Scene.forever(name, ms, delay, timing, vars)


static func _circuit(s: Scene, root: Scene.Shape) -> void:
	for index in range(TRACES.size()):
		s.path(root, TRACES[index], {"fill": null, "stroke": WIRE, "width": 1.2, "dash": [420], "anims": [Scene.motion("ohUpdDraw", 1600.0, 100.0 + index * 120.0, DRAW, {"length": 420.0})]})
	for index in range(PADS.size()):
		var pad: Array = PADS[index]
		s.circle(root, float(pad[0]), float(pad[1]), 3.5, {"fill": GROUND, "stroke": LINE, "width": 1.2})
		s.circle(root, float(pad[0]), float(pad[1]), 1.6, {"fill": SIGNAL, "anims": [Scene.forever("ohUpdTwinkle", 2600.0, index * 430.0, BREATH)]})


static func _lock(s: Scene, parent: Scene.Shape, x: float, y: float, colour: Color) -> void:
	var lock := s.group(parent, {"offset": Vector2(x, y)})
	s.path(lock, "M3 7 V4.5 a4 4 0 0 1 8 0 V7", {"fill": null, "stroke": colour, "width": 1.6})
	s.rect(lock, 1, 7, 12, 8, {"fill": colour, "rx": 1.5})


static func _ground(still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, 800, 220), "slice", still)
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.rect(s.root, 0, 0, 800, 220, {"fill": GROUND})
	_circuit(s, s.root)
	return s


static func skips(still: bool, narrow: bool) -> Scene:
	var s := _ground(still)
	var root: Scene.Shape = s.root
	var request := s.group(root, {"css": [["translate", 250.0, 26.0], ["scale", 0.86]] if narrow else [["translate", 150.0, 26.0]]})
	s.rect(request, 0, 0, 230, 172, {"fill": PANEL, "rx": 6.0, "stroke": LINE})
	s.rect(request, 12, 12, 206, 58, {"fill": Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.1), "rx": 4.0, "stroke": SIGNAL, "width": 1.2})
	for row in range(4):
		s.rect(request, 24, 22 + row * 11, 150 - (row % 2) * 34, 5, {"fill": Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.45), "rx": 2.5})
	_lock(s, request, 196, 20, SIGNAL)
	for row in range(LIVE.size()):
		var full := float(LIVE[row])
		var to := float(TRIMMED[row]) / full
		var props := {"fill": BAR, "rx": 2.0, "origin": "left"}
		if still:
			props["css"] = [["scale", to, 1.0]]
		else:
			props["anims"] = [_loop("ohAiTrim", 5200.0, 400.0 + row * 120.0, EASE, {"to": to})]
		s.rect(request, 12, 82 + row * 17, 206.0 * full, 9, props)
	var wire := s.group(root, {"css": [["translate", 450.0, 104.0]] if narrow else [["translate", 390.0, 104.0]]})
	s.path(wire, "M0 8 H120" if narrow else "M0 8 H150", {"fill": null, "stroke": LINE, "width": 1.5})
	for index in range(3):
		s.rect(wire, 0, 5, 12, 6, {"fill": SIGNAL, "rx": 1.5, "opacity": 0.0 if still else 1.0, "anims": [_loop("ohAiPacket", 2400.0, index * 800.0, "linear", {"run": 110.0 if narrow else 140.0})]})
	var chip := s.group(wire, {"css": [["translate", 128.0, -22.0]] if narrow else [["translate", 158.0, -22.0]]})
	for at in [8, 20, 32, 44]:
		s.path(chip, "M%d -6 V0 M%d 60 V66 M-6 %d H0 M60 %d H66" % [at, at, at, at], {"fill": null, "stroke": LINE, "width": 1.5})
	s.rect(chip, 0, 0, 60, 60, {"fill": PANEL, "rx": 6.0, "stroke": SIGNAL, "width": 1.4})
	s.circle(chip, 30, 30, 13, {"fill": null, "stroke": SIGNAL, "width": 2.0, "anims": [Scene.forever("ohUpdPulse", 2400.0, 0.0, BREATH)]})
	s.circle(chip, 30, 30, 4, {"fill": SIGNAL})
	if not narrow:
		var tiers := s.group(root, {"css": [["translate", 640.0, 30.0]]})
		for row in range(6):
			var near := row < 3
			s.rect(tiers, 0, row * 16, (118 - row * 10) if near else (70 - (row - 3) * 16), 7 if near else 5, {"fill": BAR if near else DIM, "rx": 2.0, "anims": [Scene.motion("ohUpdFade", 500.0, 900.0 + row * 140.0)]})
		s.rect(tiers, -8, -8, 132, 132, {"fill": null, "rx": 4.0, "stroke": FAINT})
		s.path(tiers, "M0 116 H116", {"fill": null, "stroke": WARM, "dash": [120], "cap": "round", "width": 4.0, "anims": [Scene.motion("ohUpdDraw", 1200.0, 1700.0, DRAW, {"length": 120.0})]})
		for index in range(3):
			s.circle(tiers, float([16, 52, 88][index]), 116, 4.5, {"fill": GROUND, "stroke": WARM, "width": 2.0, "anims": [Scene.motion("ohUpdStamp", 500.0, 2200.0 + index * 180.0)]})
	return s


static func memory(still: bool, narrow: bool) -> Scene:
	var s := _ground(still)
	var root: Scene.Shape = s.root
	var now := 470.0 if narrow else 520.0
	var line := s.group(root, {"css": [["translate", 170.0, 0.0], ["scale", 0.9]] if narrow else [["translate", 40.0, 0.0]]})
	s.path(line, "M20 150 H%d" % int(now), {"fill": null, "stroke": FAINT, "dash": [560], "width": 2.0, "anims": [Scene.motion("ohUpdDraw", 1400.0, 150.0, DRAW, {"length": 560.0})]})
	for index in range(EVENTS.size()):
		var related := RELATED.has(index)
		var anims: Array = [_loop("ohAiLight", 4800.0, 0.0)] if related else [Scene.motion("ohUpdFade", 400.0, 200.0 + index * 50.0)]
		s.circle(line, float(EVENTS[index]), 150, 6.0 if related else 4.5, {"fill": SIGNAL if related else PANEL, "stroke": SIGNAL if related else BAR, "width": 1.4, "anims": anims})
	s.circle(line, now, 150, 8, {"fill": SIGNAL})
	s.circle(line, now, 150, 8, {"fill": null, "stroke": SIGNAL, "width": 1.5, "anims": [Scene.forever("ohUpdRing", 2400.0, 0.0, "cubic-bezier(0.2, 0.7, 0.2, 1)")]})
	for at in range(RELATED.size()):
		var x := float(EVENTS[int(RELATED[at])])
		var lift := 40.0 + at * 16.0
		var d := "M%s 142 C %s %s, %s %s, %s 144" % [now, now - 40.0, 150.0 - lift * 2.0, x + 40.0, 150.0 - lift * 2.0, x]
		s.path(line, d, {"fill": null, "stroke": SIGNAL, "dash": [600], "cap": "round", "width": 1.6, "anims": [_loop("ohAiBeam", 4800.0, at * 120.0, EASE, {"length": 600.0})]})
	if not narrow:
		var drawer := s.group(root, {"css": [["translate", 616.0, 44.0]]})
		s.rect(drawer, 0, 0, 140, 132, {"fill": PANEL, "rx": 6.0, "stroke": LINE})
		for row in range(3):
			var slot := s.group(drawer, {"css": [["translate", 10.0, 38.0 + row * 30.0]]})
			s.rect(slot, 0, 0, 120, 24, {"fill": null, "rx": 3.0, "stroke": FAINT})
			s.rect(slot, 54, 10, 12, 4, {"fill": BAR, "rx": 2.0})
			s.path(slot, "M10 7 h18 v8 h-10 l-4 4 v-4 h-4 z", {"fill": null, "stroke": SOFT, "join": "round", "width": 1.2})
		var slip := s.group(drawer, {"anims": [Scene.motion("ohUpdStamp", 600.0, 1400.0)]})
		s.rect(slip, 22, 8, 96, 22, {"fill": WARM, "rx": 3.0})
		s.rect(slip, 32, 14, 52, 4, {"fill": GROUND, "rx": 2.0})
		s.rect(slip, 32, 21, 34, 4, {"fill": GROUND, "rx": 2.0})
		s.circle(slip, 106, 19, 4, {"fill": GROUND})
	return s


static func setup(still: bool, narrow: bool) -> Scene:
	var s := _ground(still)
	var root: Scene.Shape = s.root
	var cards := s.group(root, {"css": [["translate", 262.0, 30.0], ["scale", 0.78]] if narrow else [["translate", 110.0, 34.0]]})
	for card in range(3):
		var lit := card == 1
		var place := s.group(cards, {"css": [["translate", card * 122.0, -10.0 if lit else 0.0]]})
		var body := s.group(place, {"anims": [Scene.motion("ohUpdRise", 600.0, 300.0 + card * 150.0)]})
		s.rect(body, 0, 0, 108, 160 if lit else 140, {"fill": Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.1) if lit else PANEL, "rx": 8.0, "stroke": SIGNAL if lit else FAINT, "width": 2.0 if lit else 1.2})
		if card == 0:
			s.path(body, "M54 22 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 z", {"fill": null, "stroke": SOFT, "join": "round", "width": 1.6})
		elif card == 1:
			s.path(body, "M54 18 l7 15 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2 z", {"fill": SIGNAL, "anims": [Scene.forever("ohUpdPulse", 2600.0, 0.0, BREATH)]})
		else:
			for y in [26, 40, 54]:
				s.path(body, "M32 %d H76" % y, {"fill": null, "stroke": FAINT, "cap": "round", "width": 3.0})
			for knob in [[44, 26], [64, 40], [38, 54]]:
				s.circle(body, float(knob[0]), float(knob[1]), 4.5, {"fill": PANEL, "stroke": SOFT, "width": 1.6})
		s.rect(body, 22, 84, 64, 6, {"fill": INK if lit else BAR, "rx": 3.0})
		s.rect(body, 16, 98, 76, 4, {"fill": DIM, "rx": 2.0})
		s.rect(body, 28, 108, 52, 4, {"fill": DIM, "rx": 2.0})
		if lit:
			s.rect(body, 14, 128, 80, 18, {"fill": SIGNAL, "rx": 3.0})
			s.path(body, "M44 137 l5 5 l10 -10", {"fill": null, "stroke": GROUND, "cap": "round", "join": "round", "width": 2.4, "dash": [30], "anims": [Scene.motion("ohUpdDraw", 500.0, 1300.0, "cubic-bezier(0.2, 0.7, 0.2, 1)", {"length": 30.0})]})
	if not narrow:
		var panel := s.group(root, {"css": [["translate", 520.0, 50.0]]})
		s.rect(panel, 0, 0, 200, 54, {"fill": PANEL, "rx": 6.0, "stroke": LINE})
		s.rect(panel, 16, 18, 96, 6, {"fill": BAR, "rx": 3.0})
		s.rect(panel, 16, 30, 70, 4, {"fill": DIM, "rx": 2.0})
		var toggle := s.group(panel, {"css": [["translate", 140.0, 15.0]]})
		s.rect(toggle, 0, 0, 46, 24, {"fill": DIM, "rx": 12.0, "stroke": FAINT})
		var track := {"fill": SIGNAL, "rx": 12.0}
		if not still:
			track["anims"] = [_loop("ohAiTrack", 6000.0, 400.0)]
		s.rect(toggle, 0, 0, 46, 24, track)
		var knob := {"fill": INK}
		if still:
			knob["css"] = [["translate", 22.0, 0.0]]
		else:
			knob["anims"] = [_loop("ohAiKnob", 6000.0, 400.0, EASE, {"run": 22.0})]
		s.circle(toggle, 12, 12, 9, knob)
		var meter := s.group(panel, {"css": [["translate", 0.0, 74.0]]})
		s.rect(meter, 0, 0, 200, 54, {"fill": PANEL, "rx": 6.0, "stroke": LINE})
		s.rect(meter, 16, 30, 168, 8, {"fill": DIM, "rx": 4.0})
		var fill := {"fill": SIGNAL, "rx": 4.0, "origin": "left"}
		if still:
			fill["css"] = [["scale", 0.82, 1.0]]
		else:
			fill["anims"] = [_loop("ohAiFill", 6000.0, 600.0, EASE, {"to": 0.82})]
		s.rect(meter, 16, 30, 168, 8, fill)
		s.path(meter, "M156 22 V44", {"fill": null, "stroke": WARM, "cap": "round", "width": 2.4})
		s.rect(meter, 16, 14, 80, 5, {"fill": BAR, "rx": 2.5})
	return s


static func _beat(still: bool) -> Control:
	var s := Scene.new(Rect2(0, 0, 8, 8), "meet", still)
	s.custom_minimum_size = Vector2(px(0.5), px(0.5))
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.rect(s.root, 0, 0, 8, 8, {"fill": SIGNAL, "rx": 2.0, "anims": [Scene.forever("ohUpdPulse", 2400.0, 0.0, BREATH)]})
	return s


static func _mark(name: String, narrow: bool, still: bool) -> Control:
	var frame := PanelContainer.new()
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_theme_stylebox_override("panel", UpdateKit.box(Color(0, 0, 0, 0), LINE, 6.0, 1, Vector4(px(0.35), px(0.35), px(0.35), px(0.35))))
	frame.add_child(UpdateKit.icon_rect(name, 30 if narrow else 38, SIGNAL))
	var holder := UpdateKit.Riser.new()
	holder.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(frame)
	if not still:
		holder.play("ohUpdTurn", 800.0, 260.0)
	return holder


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var kind := str(banner.get("scene", ""))
	var plate := UpdateKit.plate({"background": GROUND, "border": LINE, "radius": 8.0}, still)
	UpdateKit.brackets(plate, SIGNAL, px(0.6), px(1.2), 1.5, true)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(10.0) if narrow else ShellFonts.clamp_vw(11.0, 23.0, 14.5, width), 1.0, SIGNAL, GROUND)
	var art: Scene
	match kind:
		"memory":
			art = memory(still, narrow)
		"setup":
			art = setup(still, narrow)
		_:
			art = skips(still, narrow)
	holder.add_child(art)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head_row := UpdateKit.hbox(roundi(px(0.75) if narrow else px(1.0)))
	head_row.alignment = BoxContainer.ALIGNMENT_BEGIN
	head_row.add_child(_mark(str(SCENE_ICON.get(kind, "gear")), narrow, still))
	var head := UpdateKit.vbox(0)
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.76), SIGNAL, MONO, 700, false, 0.16, true))
	head.add_child(UpdateKit.gap(px(0.15)))
	head.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("title", "")), px(1.9) if narrow else ShellFonts.clamp_vw(2.1, 5.2, 3.0, width), INK, FACE, 900, false, 1.04, -0.01), 380.0, still, "ohUpdFade", 500.0))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.25)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.02), SOFT, FACE, 400))
	head_row.add_child(head)
	body.add_child(UpdateKit.reveal(head_row, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.98), SOFT, FACE, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(FAINT, _beat(still)))
	var sections: Array = banner.get("sections", [])
	var cards := UpdateKit.feature_cards(sections, SIGNAL, SOFT, {"background": Color(43 / 255.0, 193 / 255.0, 243 / 255.0, 0.04), "border": LINE, "radius": 6.0}, FACE, false, 520.0, still, 110.0, 1 if narrow else (2 if sections.size() == 4 else 0))
	cards.min_column = px(13.5)
	body.add_child(cards)
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.1), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.4), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
