extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const INK := Color("#0e1720")
const FROST := Color("#dcecf3")
const FROST_SOFT := Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.72)
const SUN := Color("#f0b44c")
const SERIF := "\"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, serif"
const SEASON_MS := 5200.0
const TURN_MS := 1400.0
const MOVE := "cubic-bezier(0.45, 0, 0.2, 1)"
const WAVE := "cubic-bezier(0.4, 0, 0.6, 1)"
const SEASONS := [
	{"key": "winter", "label": "Winter", "icon": "snow", "sky": "#1f2c38", "far": "#45525e", "peaks": 1.0, "near": "#34404a", "ground": "#c9d8e1", "lake": "#9fc3d6", "crown": "#56636b", "crowned": 0.0, "sun": [640.0, 96.0, 20.0, "#e6edf1"]},
	{"key": "spring", "label": "Spring", "icon": "rain", "sky": "#29404f", "far": "#41545f", "peaks": 0.45, "near": "#33503c", "ground": "#4f7a45", "lake": "#2c5c76", "crown": "#86b86b", "crowned": 1.0, "sun": [600.0, 64.0, 22.0, "#f3d27a"]},
	{"key": "summer", "label": "Summer", "icon": "sun", "sky": "#2c5874", "far": "#4a5e66", "peaks": 0.12, "near": "#36552f", "ground": "#62843b", "lake": "#286d8e", "crown": "#3f7a3a", "crowned": 1.0, "sun": [560.0, 40.0, 28.0, "#f0b44c"]},
	{"key": "autumn", "label": "Autumn", "icon": "leaf", "sky": "#37352f", "far": "#4c4a43", "peaks": 0.35, "near": "#57452f", "ground": "#7b5b33", "lake": "#34576a", "crown": "#c8663a", "crowned": 1.0, "sun": [660.0, 82.0, 24.0, "#e59a4a"]},
]
const TREES := [[470.0, 1.0, false], [505.0, 0.8, true], [540.0, 1.15, false], [580.0, 0.9, true], [615.0, 1.05, false], [655.0, 0.85, false], [690.0, 1.1, true], [730.0, 0.95, false], [768.0, 1.2, false]]
const CRACKS := ["M80 186 l34 -5 22 8 30 -9 24 6", "M170 196 l26 -6 34 7 28 -8", "M120 194 l18 -3 14 6", "M250 184 l22 4 18 -6"]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func chrome() -> Dictionary:
	return {
		"button": {"bg": SUN, "border": SUN, "radius": 10.0, "ink": INK, "font": SERIF, "weight": 700, "spacing": 0.03},
		"arrow": {"bg": Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.06), "border": FROST, "ink": FROST},
		"dot": {"on": SUN, "off": Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.3)},
		"skip": {"ink": FROST, "font": SERIF, "italic": true},
	}


class Landscape extends Control:
	var still := false
	var narrow := false
	var season := 0
	var chosen := false
	var scene: Scene
	var parts := {}
	var keys: HFlowContainer
	var buttons: Array[Button] = []

	static func with(base: Dictionary, extra: Dictionary) -> Dictionary:
		var merged := base.duplicate()
		for key in extra.keys():
			merged[key] = extra[key]
		return merged


	static func turning() -> Dictionary:
		return {"transition": {"ms": TURN_MS, "timing": "ease", "offset_timing": MOVE}}

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_PASS
		clip_contents = true

	func _ready() -> void:
		scene = Scene.new(Rect2(0, 0, 800, 220), "slice", still)
		scene.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		add_child(scene)
		_build()
		keys = HFlowContainer.new()
		keys.mouse_filter = Control.MOUSE_FILTER_IGNORE
		keys.add_theme_constant_override("h_separation", roundi(UpdateKit.px(0.25) if narrow else UpdateKit.px(0.35)))
		keys.add_theme_constant_override("v_separation", roundi(UpdateKit.px(0.25) if narrow else UpdateKit.px(0.35)))
		keys.anchor_left = 0.0
		keys.anchor_right = 1.0
		keys.anchor_top = 1.0
		keys.anchor_bottom = 1.0
		keys.offset_left = UpdateKit.px(0.5) if narrow else UpdateKit.px(0.7)
		keys.offset_right = -UpdateKit.px(0.7)
		keys.offset_bottom = -UpdateKit.px(0.6)
		keys.offset_top = -UpdateKit.px(0.6)
		keys.grow_vertical = Control.GROW_DIRECTION_BEGIN
		add_child(keys)
		for at in range(SEASONS.size()):
			var button := Button.new()
			button.focus_mode = Control.FOCUS_NONE
			button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
			button.pressed.connect(func() -> void: pick(at))
			keys.add_child(button)
			buttons.append(button)
		_style_keys()
		if not still:
			var timer := Timer.new()
			timer.wait_time = SEASON_MS / 1000.0
			timer.autostart = true
			timer.timeout.connect(func() -> void:
				if not chosen:
					_show((season + 1) % SEASONS.size()))
			add_child(timer)

	func pick(at: int) -> void:
		chosen = true
		_show(at)

	func _show(at: int) -> void:
		var was_winter := str(SEASONS[season]["key"]) == "winter"
		season = at
		var look: Dictionary = SEASONS[season]
		var is_winter := str(look["key"]) == "winter"
		scene.set_fill(parts["sky"], look["sky"])
		var sun_spec: Array = look["sun"]
		scene.shift_to(parts["sun"], Vector2(float(sun_spec[0]), float(sun_spec[1])))
		scene.reshape_ellipse(parts["sun_disc"], 0.0, 0.0, float(sun_spec[2]), float(sun_spec[2]))
		scene.set_fill(parts["sun_disc"], sun_spec[3])
		scene.set_anims(parts["sun_disc"], [Scene.forever("ohUpdPulse", 2600.0, 0.0, WAVE)] if str(look["key"]) == "summer" else [])
		for cloud in parts["clouds"]:
			var shapes: Array = cloud
			scene.set_opacity(shapes[0], _cloud_opacity(look))
			scene.set_fill(shapes[1], "#5d6d78" if str(look["key"]) == "spring" else "#6d7a84")
			scene.set_fill(shapes[2], "#5d6d78" if str(look["key"]) == "spring" else "#6d7a84")
		scene.set_fill(parts["far"], look["far"])
		scene.set_opacity(parts["snowcaps"], float(look["peaks"]))
		scene.set_fill(parts["near"], look["near"])
		scene.set_fill(parts["ground"], look["ground"])
		scene.set_fill(parts["lake"], look["lake"])
		scene.set_opacity(parts["ripples"], 0.0 if is_winter else 1.0)
		var ice: Scene.Shape = parts["ice"]
		ice.opacity = 1.0 if is_winter else 0.0
		if is_winter and not was_winter:
			_crack_anims(ice)
		for tree in parts["trees"]:
			var entry: Dictionary = tree
			if bool(entry["pine"]):
				scene.set_fill(entry["crown"], "#3f5a4c" if is_winter else "#2f5a3e")
				scene.set_opacity(entry["frost"], 1.0 if is_winter else 0.0)
			else:
				scene.set_fill(entry["crown"], look["crown"])
				scene.set_opacity(entry["crown"], float(look["crowned"]))
				scene.set_opacity(entry["blossom"], 1.0 if str(look["key"]) == "spring" else 0.0)
				scene.set_opacity(entry["frost"], 0.0)
		scene.set_opacity(parts["snow"], 1.0 if is_winter else 0.0)
		scene.set_opacity(parts["rain"], 1.0 if str(look["key"]) == "spring" else 0.0)
		scene.set_opacity(parts["heat"], 1.0 if str(look["key"]) == "summer" else 0.0)
		scene.set_opacity(parts["autumn"], 1.0 if str(look["key"]) == "autumn" else 0.0)
		_style_keys()

	func _cloud_opacity(look: Dictionary) -> float:
		match str(look["key"]):
			"summer":
				return 0.35
			"spring":
				return 0.95
		return 0.75

	func _crack_anims(ice: Scene.Shape) -> void:
		for at in range(ice.children.size()):
			var crack: Scene.Shape = ice.children[at]
			if still:
				crack.dash = PackedFloat32Array()
				scene.set_anims(crack, [])
			else:
				crack.dash = PackedFloat32Array([160.0])
				scene.set_anims(crack, [Scene.motion("ohUpdDraw", 1500.0, 500.0 + at * 260.0, MOVE, {"length": 160.0})])

	func _falling(at: int, span: float, duration: float, rest: float) -> Dictionary:
		if still:
			return {"css": [["translate", 0.0, rest]]}
		return {"anims": [Scene.forever("ohUpdFall", duration, fmod(float(at) * 211.0, duration), "linear", {"fall": span})]}

	func _build() -> void:
		var s := scene
		var root: Scene.Shape = s.root
		var look: Dictionary = SEASONS[season]
		var is_winter := true
		parts["sky"] = s.rect(root, 0, 0, 800, 220, with({"fill": look["sky"]}, turning()))
		var sun_spec: Array = look["sun"]
		parts["sun"] = s.group(root, with({"offset": Vector2(float(sun_spec[0]), float(sun_spec[1]))}, turning()))
		parts["sun_disc"] = s.circle(parts["sun"], 0, 0, float(sun_spec[2]), with({"fill": sun_spec[3]}, turning()))
		var clouds: Array = []
		var cloud_specs := [[0, 26.0, 150.0, 22000.0], [1, 54.0, 110.0, 30000.0], [2, 14.0, 190.0, 26000.0]]
		for spec in cloud_specs:
			var at: int = spec[0]
			var y: float = spec[1]
			var width: float = spec[2]
			var pace: float = spec[3]
			var drift := {} if still else {"anims": [Scene.forever("ohUpdDrift", pace, -pace * (0.2 + at * 0.3), "linear", {"from": -260.0, "to": 860.0})]}
			var mover := s.group(root, drift)
			var shade := s.group(mover, with({"opacity": _cloud_opacity(look)}, turning()))
			var big := s.rect(shade, 0, y, width, 20, with({"fill": "#6d7a84", "rx": 10}, turning()))
			var small := s.rect(shade, width * 0.2, y - 10, width * 0.55, 16, with({"fill": "#6d7a84", "rx": 8}, turning()))
			clouds.append([shade, big, small])
		parts["clouds"] = clouds
		parts["far"] = s.path(root, "M0 150 L70 84 L118 118 L182 52 L248 128 L310 92 L372 150 Z", with({"fill": look["far"]}, turning()))
		parts["snowcaps"] = s.path(root, "M182 52 L204 78 L190 74 L178 84 L166 74 Z M70 84 L84 100 L66 96 Z M310 92 L324 106 L306 104 Z", with({"fill": FROST, "opacity": float(look["peaks"])}, turning()))
		parts["near"] = s.path(root, "M300 160 L380 106 L440 140 L520 98 L600 150 L700 112 L800 150 L800 220 L300 220 Z", with({"fill": look["near"]}, turning()))
		parts["ground"] = s.rect(root, 0, 164, 800, 56, with({"fill": look["ground"]}, turning()))
		parts["lake"] = s.ellipse(root, 190, 188, 150, 20, with({"fill": look["lake"]}, turning()))
		var ripples := s.group(root, with({"opacity": 0.0 if is_winter else 1.0}, turning()))
		for at in range(3):
			s.path(ripples, "M%s %s q12 -4 24 0" % [110 + at * 55, 184 + (at % 2) * 8], {"fill": null, "stroke": "#9cc6da", "width": 1.2, "anims": [Scene.forever("ohUpdPulse", 2200.0, at * 500.0, WAVE)]})
		parts["ripples"] = ripples
		var ice := s.group(root, {"opacity": 1.0 if is_winter else 0.0})
		for d in CRACKS:
			s.path(ice, d, {"fill": null, "stroke": "#f2f8fb", "cap": "round", "width": 1.3})
		parts["ice"] = ice
		_crack_anims(ice)
		var trees: Array = []
		for tree in TREES:
			var x: float = tree[0]
			var scale_value: float = tree[1]
			var pine: bool = tree[2]
			var holder := s.group(root, {"css": [["translate", x, 170.0], ["scale", scale_value]], "origin": {"kind": "view", "at": Vector2.ZERO}})
			s.rect(holder, -2.5, -22, 5, 22, {"fill": "#4a3a2a"})
			var entry := {"pine": pine}
			if pine:
				entry["crown"] = s.path(holder, "M0 -62 L16 -22 L-16 -22 Z", with({"fill": "#3f5a4c" if is_winter else "#2f5a3e"}, turning()))
			else:
				s.path(holder, "M0 -20 L-10 -36 M0 -26 L9 -40 M0 -30 L0 -46", {"fill": null, "stroke": "#4a3a2a", "width": 2.0})
				entry["crown"] = s.circle(holder, 0, -38, 16, with({"fill": look["crown"], "opacity": float(look["crowned"])}, turning()))
				var blossom := s.group(holder, with({"opacity": 1.0 if str(look["key"]) == "spring" else 0.0}, turning()))
				for spot in [[-7.0, -42.0], [6.0, -46.0], [8.0, -33.0], [-5.0, -31.0], [0.0, -50.0]]:
					s.circle(blossom, spot[0], spot[1], 2.4, {"fill": "#f4cfd8"})
				entry["blossom"] = blossom
			entry["frost"] = s.path(holder, "M-16 -22 L16 -22", with({"fill": null, "stroke": FROST, "width": 2.5, "opacity": 1.0 if is_winter and pine else 0.0}, turning()))
			trees.append(entry)
		parts["trees"] = trees
		var snow := s.group(root, with({"opacity": 1.0 if is_winter else 0.0}, turning()))
		for at in range(46):
			s.circle(snow, 6 + ((at * 53) % 790), -6, 2.2 if at % 4 == 0 else 1.4, with({"fill": FROST}, _falling(at, 236.0, 3600.0 + (at % 6) * 420.0, 14.0 + ((at * 37) % 190))))
		parts["snow"] = snow
		var rain := s.group(root, with({"opacity": 0.0}, turning()))
		for at in range(52):
			var x := 4.0 + ((at * 31) % 796)
			s.line(rain, x, -14, x - 6.0, 2, with({"stroke": "#9fc0d2", "cap": "round", "width": 1.3}, _falling(at, 240.0, 820.0 + (at % 5) * 110.0, 10.0 + ((at * 41) % 190))))
		parts["rain"] = rain
		var heat := s.group(root, with({"opacity": 0.0}, turning()))
		for at in range(7):
			s.path(heat, "M%s 176 q8 -8 0 -16 q-8 -8 0 -16" % (60 + at * 110), {"fill": null, "stroke": SUN, "cap": "round", "width": 1.6, "opacity": 0.65, "anims": [Scene.forever("ohUpdSway", 1700.0, at * 240.0, WAVE)]})
		parts["heat"] = heat
		var autumn := s.group(root, with({"opacity": 0.0}, turning()))
		for at in range(2):
			s.rect(autumn, 20, 150 + at * 16, 760, 10, {"fill": "#d9d2c4", "opacity": 0.22, "rx": 5, "anims": [Scene.forever("ohUpdDrift", 16000.0 + at * 5000.0, -at * 7000.0, "linear", {"from": -320.0, "to": 320.0})]})
		var leaf_colours := ["#e0a050", "#c8663a", "#a8482c"]
		for at in range(24):
			var leaf := s.group(autumn, _falling(at, 220.0, 4200.0 + (at % 5) * 600.0, 20.0 + ((at * 43) % 170)))
			s.path(leaf, "M%s 0 l5 -4 5 4 -5 4 z" % (20 + ((at * 67) % 770)), {"fill": leaf_colours[at % 3], "anims": [Scene.forever("ohUpdSway", 1400.0 + (at % 4) * 300.0, at * 120.0, WAVE)]})
		parts["autumn"] = autumn

	func _style_keys() -> void:
		for at in range(buttons.size()):
			var button := buttons[at]
			var on := at == season
			var entry: Dictionary = SEASONS[at]
			var ink := INK if on else FROST
			var pad := UpdateKit.px(0.45) if narrow else UpdateKit.px(0.8)
			var style := UpdateKit.box(SUN if on else Color(14 / 255.0, 23 / 255.0, 32 / 255.0, 0.72), SUN if on else Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.45), 999.0, 1, Vector4(pad, 0, pad, 0))
			for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
				button.add_theme_stylebox_override(state, style)
			for child in button.get_children():
				button.remove_child(child)
				child.queue_free()
			var row := UpdateKit.hbox(roundi(UpdateKit.px(0.2) if narrow else UpdateKit.px(0.3)))
			row.alignment = BoxContainer.ALIGNMENT_CENTER
			row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
			row.add_child(UpdateKit.icon_rect(str(entry["icon"]), 12 if narrow else 16, ink))
			var caption := UpdateKit.text(str(entry["label"]), UpdateKit.px(0.7) if narrow else UpdateKit.px(0.82), ink, SERIF, 700)
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
	var plate := UpdateKit.plate({"background": INK, "border": Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.28), "radius": 14.0}, still)
	UpdateKit.brackets(plate, FROST, px(0.7), px(1.6), 1.5)
	var column := UpdateKit.vbox(0)
	var holder := UpdateKit.frame(px(12.0) if narrow else ShellFonts.clamp_vw(13.0, 27.0, 17.0, width), 1.0, Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.2))
	var land := Landscape.new()
	land.still = still
	land.narrow = narrow
	holder.add_child(land)
	column.add_child(UpdateKit.reveal(holder, 150.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	var line: Array[Dictionary] = [UpdateKit.run(UpdateKit.major_line(update), px(0.8), SUN, SERIF, 400, false, 0.16, false, true)]
	head.add_child(UpdateKit.runs(line))
	head.add_child(UpdateKit.gap(px(0.2)))
	head.add_child(UpdateKit.para(str(banner.get("title", "")), px(2.1) if narrow else ShellFonts.clamp_vw(2.3, 6.0, 3.2, width), FROST, SERIF, 700, false, 1.05))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.2)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.05), SUN, SERIF, 400, true))
	body.add_child(UpdateKit.reveal(head, 300.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.9)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(1.0), FROST_SOFT, SERIF, 400, false, 1.6), 420.0, still))
	body.add_child(UpdateKit.rule(FROST, UpdateKit.icon_rect("snow", 18, SUN)))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), SUN, FROST_SOFT, {"background": Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.04), "border": Color(220 / 255.0, 236 / 255.0, 243 / 255.0, 0.18), "radius": 10.0}, SERIF, false, 520.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.2), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.5), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
