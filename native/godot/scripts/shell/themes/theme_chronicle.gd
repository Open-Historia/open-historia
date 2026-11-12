extends RefCounted

const Scene := preload("res://scripts/shell/themes/upd_scene.gd")

const FONTS := {
	"serif": "Georgia, \"Times New Roman\", serif",
	"mono": "\"Courier New\", Courier, monospace",
	"stencil": "\"Bahnschrift Condensed\", \"Bahnschrift\", \"DIN Condensed\", \"Oswald\", \"Arial Narrow\", sans-serif",
	"rounded": "\"Trebuchet MS\", \"Segoe UI\", sans-serif",
	"sans": "\"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
}
const W := 800.0
const H := 180.0
const EASE := "cubic-bezier(0.45, 0, 0.2, 1)"
const WAVE := "cubic-bezier(0.4, 0, 0.6, 1)"
const LANDS := ["M60 40 L180 30 L230 80 L170 130 L80 120 Z", "M230 80 L330 50 L380 110 L300 150 L170 130 Z", "M330 50 L470 40 L500 100 L380 110 Z", "M380 110 L500 100 L540 160 L420 170 L300 150 Z", "M470 40 L600 30 L640 90 L500 100 Z", "M500 100 L640 90 L700 150 L540 160 Z"]
const SCRIPTS := ["A", "Я", "語", "ع", "Ω", "ह", "ก", "한", "ß", "ñ", "Ж", "字", "λ", "ç", "ש", "ü"]


static func px(value: float) -> float:
	return UpdateKit.px(value)


static func hex(value: String) -> Color:
	return Scene.color(value)


static func palette(banner: Dictionary) -> Dictionary:
	var raw: Dictionary = banner.get("palette", {})
	var font_key := str(raw.get("font", ""))
	return {
		"accent": hex(str(raw.get("accent", ""))) if not str(raw.get("accent", "")).is_empty() else hex("#c9a54c"),
		"ground": hex(str(raw.get("ground", ""))) if not str(raw.get("ground", "")).is_empty() else hex("#121417"),
		"ink": hex(str(raw.get("ink", ""))) if not str(raw.get("ink", "")).is_empty() else hex("#f3efe6"),
		"soft": hex(str(raw.get("soft", ""))) if not str(raw.get("soft", "")).is_empty() else Color(243 / 255.0, 239 / 255.0, 230 / 255.0, 0.72),
		"font": str(FONTS.get(font_key, FONTS["sans"])),
		"caps": font_key == "stencil" or font_key == "mono",
		"accent_hex": str(raw.get("accent", "#c9a54c")) if not str(raw.get("accent", "")).is_empty() else "#c9a54c",
	}


static func faded(p: Dictionary, alpha_hex: String) -> Color:
	var raw := str(p["accent_hex"])
	var base: Color = p["accent"]
	if raw.length() == 7 and raw.begins_with("#"):
		return Color(base.r, base.g, base.b, float(alpha_hex.hex_to_int()) / 255.0)
	return base


static func chrome(banner: Dictionary) -> Dictionary:
	var p := palette(banner)
	var caps: bool = p["caps"]
	return {
		"button": {"bg": p["accent"], "border": p["accent"], "radius": 6.0, "ink": p["ground"], "font": p["font"], "spacing": 0.1 if caps else 0.02, "caps": caps},
		"arrow": {"bg": faded(p, "14"), "border": faded(p, "aa"), "ink": p["accent"]},
		"dot": {"on": p["accent"], "off": faded(p, "4d")},
		"skip": {"ink": p["accent"], "font": p["font"]},
	}


static func drawn(still: bool, length: float, duration: float, delay: float) -> Dictionary:
	if still:
		return {}
	return {"dash": [length], "anims": [Scene.motion("ohUpdDraw", duration, delay, EASE, {"length": length})]}


static func carried(still: bool, from: float, to: float, duration: float, delay: float, again := false) -> Dictionary:
	if still:
		return {}
	if again:
		return {"anims": [Scene.forever("ohUpdDrift", duration, delay, "linear", {"from": from, "to": to})]}
	return {"anims": [Scene.motion("ohUpdDrift", duration, delay, EASE, {"from": from, "to": to})]}


static func falling(still: bool, by: float, duration: float, delay: float) -> Dictionary:
	if still:
		return {}
	return {"anims": [Scene.forever("ohUpdFall", duration, delay, "linear", {"fall": by})]}


static func spinning(still: bool, duration: float, reverse := false) -> Dictionary:
	if still:
		return {}
	return {"anims": [Scene.forever("ohUpdSpin", duration, 0.0, "linear", {}, reverse)]}


static func pulsing(still: bool, duration: float, delay := 0.0) -> Dictionary:
	if still:
		return {}
	return {"anims": [Scene.forever("ohUpdPulse", duration, delay, WAVE)]}


static func appearing(still: bool, delay: float, duration := 400.0) -> Dictionary:
	if still:
		return {}
	return {"anims": [Scene.motion("ohUpdFade", duration, delay)]}


static func with(base: Dictionary, extra: Dictionary) -> Dictionary:
	var merged := base.duplicate()
	for key in extra.keys():
		merged[key] = extra[key]
	return merged


static func grid(s: Scene, parent: Scene.Shape, ink: Color, step := 40.0) -> void:
	for at in range(floori(W / step + 1.0)):
		s.line(parent, float(at) * step, 0.0, float(at) * step, H, {"stroke": ink, "stroke_opacity": 0.06})
	for at in range(floori(H / step + 1.0)):
		s.line(parent, 0.0, float(at) * step, W, float(at) * step, {"stroke": ink, "stroke_opacity": 0.06})


static func rotate_about(degrees: float, cx: float, cy: float) -> Transform2D:
	return Transform2D(0.0, Vector2(cx, cy)) * Transform2D(deg_to_rad(degrees), Vector2.ZERO) * Transform2D(0.0, Vector2(-cx, -cy))


static func scene(name: String, p: Dictionary, still: bool) -> Scene:
	var s := Scene.new(Rect2(0, 0, W, H), "slice", still)
	var root: Scene.Shape = s.root
	var accent: Color = p["accent"]
	var ink: Color = p["ink"]
	var ground: Color = p["ground"]
	s.rect(root, 0, 0, W, H, {"fill": ground})
	match name:
		"fleet":
			s.rect(root, 0, 120, W, 60, {"fill": ink, "fill_opacity": 0.05})
			var ships := [[140.0, 128.0, 1.0], [600.0, 132.0, -1.0]]
			for at in range(ships.size()):
				var x: float = ships[at][0]
				var y: float = ships[at][1]
				var facing: float = ships[at][2]
				var bob := {} if still else {"anims": [Scene.forever("ohUpdBob", 3600.0 + at * 500.0, at * 700.0, WAVE, {"tilt": -2.0})]}
				var ship := s.group(root, bob)
				s.path(ship, "M%s %s h120 l-14 16 h-92 z M%s %s v-34 h4 v34 M%s %s v-46 h4 v46 M%s %s l%s 14 l%s 6 z M%s %s l%s 18 l%s 8 z" % [x - 60, y, x - 30, y, x + 10, y, x - 26, y - 30, facing * 28, -facing * 28, x + 14, y - 42, facing * 34, -facing * 34], {"fill": ink, "opacity": 0.85})
				for gun in range(3):
					s.circle(ship, x + facing * (66 + gun * 6), y + 6 + gun * 2, 4, with({"fill": accent}, pulsing(still, 900.0, at * 450.0 + gun * 150.0)))
			for at in range(10):
				s.circle(root, 260 + at * 30, 110, 10 + (at % 3) * 5, with({"fill": ink, "fill_opacity": 0.12}, falling(still, -70.0, 4200.0 + at * 200.0, at * 380.0)))
			var treaty := s.group(root, appearing(still, 600.0, 900.0))
			s.rect(treaty, 325, 14, 150, 44, {"fill": ink, "fill_opacity": 0.9, "rx": 4})
			for row in range(3):
				s.line(treaty, 340, 26 + row * 9, 440 - row * 18, 26 + row * 9, {"stroke": ground, "width": 2.0})
			s.circle(treaty, 458, 48, 11, with({"fill": accent}, {} if still else {"anims": [Scene.motion("ohUpdStamp", 700.0, 1500.0)]}))
		"lens":
			grid(s, root, ink)
			for at in range(LANDS.size()):
				s.path(root, LANDS[at], {"fill": accent, "fill_opacity": 0.06 + (at % 3) * 0.04, "stroke": ink, "stroke_opacity": 0.2})
			var rings := [30.0, 55.0, 80.0]
			for at in range(rings.size()):
				var r: float = rings[at]
				s.ellipse(root, 420, 95, r * 2.2, r, with({"fill": null, "stroke": accent, "width": 1.2}, drawn(still, 900.0, 2400.0, 300.0 + at * 400.0)))
			var glass := s.group(root, carried(still, -120.0, 640.0, 9000.0, 0.0, true))
			s.circle(glass, 100, 90, 52, {"fill": ink, "fill_opacity": 0.08, "stroke": ink, "width": 5.0})
			s.line(glass, 138, 128, 176, 166, {"stroke": ink, "cap": "round", "width": 10.0})
		"vault":
			grid(s, root, ink, 30.0)
			s.circle(root, 400, 90, 84, {"fill": ink, "fill_opacity": 0.1, "stroke": ink, "stroke_opacity": 0.5, "width": 6.0})
			for at in range(16):
				s.circle(root, 400 + cos(at * PI / 8.0) * 74, 90 + sin(at * PI / 8.0) * 74, 3.5, {"fill": ink, "fill_opacity": 0.6})
			var wheel := s.group(root, spinning(still, 9000.0))
			s.circle(wheel, 400, 90, 40, {"fill": null, "stroke": accent, "width": 5.0})
			for at in range(6):
				s.line(wheel, 400 + cos(at * PI / 3.0) * 14, 90 + sin(at * PI / 3.0) * 14, 400 + cos(at * PI / 3.0) * 54, 90 + sin(at * PI / 3.0) * 54, {"stroke": accent, "cap": "round", "width": 6.0})
			s.circle(wheel, 400, 90, 10, {"fill": accent})
			s.path(root, "M316 90 H230 M484 90 H570", {"stroke": ink, "stroke_opacity": 0.3, "width": 2.0})
		"press":
			var placed := Transform2D(0.0, Vector2(80, 10)) * Transform2D(0.0, Vector2(0.92, 0.92), 0.0, Vector2.ZERO)
			for at in range(LANDS.size()):
				s.path(root, LANDS[at], with({"fill": accent, "fill_opacity": 0.5, "stroke": ground, "width": 2.0, "transform": placed}, pulsing(still, 2600.0, at * 430.0)))
			for at in range(4):
				var sheet := s.group(root, appearing(still, 200.0 + at * 450.0, 500.0))
				var turn := rotate_about(-8.0 + at * 5.0, 70.0 + at * 34.0, 40.0)
				s.rect(sheet, 36 + at * 34, 12, 70, 58, {"fill": ink, "rx": 2, "transform": turn})
				for row in range(4):
					s.line(sheet, 44 + at * 34, 24 + row * 10, 96 + at * 34, 24 + row * 10, {"stroke": ground, "stroke_opacity": 0.9 if row == 0 else 0.45, "width": 4.0 if row == 0 else 2.0, "transform": turn})
			for at in range(8):
				s.circle(root, 240 + at * 55, 10, 3, with({"fill": ink}, falling(still, 120.0, 2200.0 + (at % 3) * 300.0, at * 260.0)))
		"projection":
			s.circle(root, 190, 90, 70, {"fill": accent, "fill_opacity": 0.12, "stroke": accent, "width": 2.0})
			for rx in [20.0, 42.0, 62.0]:
				s.ellipse(root, 190, 90, rx, 70, with({"fill": null, "stroke": ink, "stroke_opacity": 0.3}, {} if still else {"anims": [Scene.forever("ohUpdSway", 3000.0 + rx * 20.0, 0.0, WAVE)]}))
			for dy in [-40.0, 0.0, 40.0]:
				s.ellipse(root, 190, 90 + dy, 70.0 if dy == 0.0 else 57.0, 8, {"fill": null, "stroke": ink, "stroke_opacity": 0.3})
			s.path(root, "M280 90 H360", with({"stroke": accent, "dash": [6, 6], "width": 2.0}, drawn(still, 90.0, 700.0, 400.0)))
			s.path(root, "M352 82 L364 90 L352 98", with({"fill": null, "stroke": accent, "width": 2.0}, appearing(still, 1000.0)))
			s.rect(root, 390, 30, 300, 120, with({"fill": accent, "fill_opacity": 0.1, "stroke": accent, "width": 2.0}, appearing(still, 900.0, 600.0)))
			for at in range(6):
				s.line(root, 390 + at * 60, 30, 390 + at * 60, 150, with({"stroke": ink, "stroke_opacity": 0.3}, drawn(still, 130.0, 600.0, 1100.0 + at * 90.0)))
			for at in range(3):
				s.line(root, 390, 60 + at * 30, 690, 60 + at * 30, with({"stroke": ink, "stroke_opacity": 0.3}, drawn(still, 310.0, 600.0, 1400.0 + at * 90.0)))
			s.path(root, "M430 60 L500 50 L540 90 L470 120 Z M560 70 L640 64 L660 110 L590 130 Z", with({"fill": ink, "fill_opacity": 0.5}, appearing(still, 1800.0, 700.0)))
		"chunks":
			s.rect(root, 250, 25, 300, 130, {"fill": null, "rx": 8, "stroke": ink, "stroke_opacity": 0.5, "width": 3.0})
			s.line(root, 250, 47, 550, 47, {"stroke": ink, "stroke_opacity": 0.5, "width": 3.0})
			for at in range(12):
				var x := 270.0 + (at % 6) * 45.0
				var y := 62.0 + floorf(at / 6.0) * 42.0
				var piece := {} if still else {"anims": [Scene.motion("ohUpdDrift", 900.0, 150.0 + at * 140.0, EASE, {"from": (1.0 if at % 2 == 1 else -1.0) * (180.0 + at * 12.0), "to": 0.0})]}
				s.rect(root, x, y, 38, 34, with({"fill": accent, "rx": 4}, piece))
			var stamp := {} if still else {"anims": [Scene.motion("ohUpdStamp", 700.0, 2000.0)]}
			s.circle(root, 600, 60, 22, with({"fill": null, "stroke": accent, "width": 3.0}, stamp))
			s.path(root, "M589 60 l8 8 l15 -16", with({"fill": null, "stroke": accent, "width": 4.0}, stamp))
		"network":
			var seats: Array[Vector2] = []
			for at in range(6):
				seats.append(Vector2(400 + cos(at * PI / 3.0 + 0.5) * 230, 90 + sin(at * PI / 3.0 + 0.5) * 62))
			grid(s, root, ink, 50.0)
			for at in range(seats.size()):
				s.line(root, 400, 90, seats[at].x, seats[at].y, with({"stroke": accent, "stroke_opacity": 0.6, "width": 2.0}, drawn(still, 260.0, 700.0, 200.0 + at * 150.0)))
			for at in range(seats.size()):
				var seat := seats[at]
				s.circle(root, seat.x + (400 - seat.x) * 0.5, seat.y + (90 - seat.y) * 0.5, 4, with({"fill": ink}, pulsing(still, 1200.0, at * 200.0)))
			for at in range(seats.size()):
				var seat := seats[at]
				var table := s.group(root, appearing(still, 300.0 + at * 150.0))
				s.rect(table, seat.x - 20, seat.y - 14, 40, 28, {"fill": ground, "rx": 6, "stroke": accent, "width": 2.0})
				s.circle(table, seat.x, seat.y, 6, {"fill": accent})
			s.circle(root, 400, 90, 26, with({"fill": accent}, pulsing(still, 1800.0)))
			s.circle(root, 400, 90, 38, {"fill": null, "stroke": accent, "stroke_opacity": 0.5, "width": 2.0})
		"phone":
			for block in [[0, 120, 70], [70, 100, 50], [130, 130, 60], [500, 110, 50], [560, 90, 70], [640, 125, 60], [710, 105, 90]]:
				s.rect(root, float(block[0]), float(block[1]), float(block[2]), H - float(block[1]), {"fill": ink, "fill_opacity": 0.1})
			s.rect(root, 352, 10, 96, 160, {"fill": ground, "rx": 16, "stroke": ink, "width": 4.0})
			var screen := s.group(root, {})
			screen.clip = UpdateKit.rounded(Rect2(360, 22, 80, 140), 6.0)
			for at in range(7):
				var odd := at % 2 == 1
				s.rect(screen, (392.0 - (at % 3) * 10.0) if odd else 364.0, 170, 44 + (at % 3) * 10, 16, with({"fill": accent if odd else ink, "fill_opacity": 0.85 if odd else 0.6, "rx": 8}, falling(still, -170.0, 4200.0, at * 600.0)))
		"scroll":
			s.rect(root, 220, 15, 360, 150, {"fill": ink, "fill_opacity": 0.92, "rx": 4})
			for at in range(8):
				s.line(root, 244, 34 + at * 16, 540 - (at % 3) * 40, 34 + at * 16, {"stroke": ground, "stroke_opacity": 0.4, "width": 3.0})
			var marks := [[260.0, 50.0, 120.0], [300.0, 98.0, 90.0], [250.0, 130.0, 140.0]]
			for at in range(marks.size()):
				var x: float = marks[at][0]
				var y: float = marks[at][1]
				var w: float = marks[at][2]
				s.line(root, x, y, x + w, y, with({"stroke": accent, "width": 3.0}, drawn(still, w + 10.0, 500.0, 400.0 + at * 450.0)))
			var carets := [[392.0, 46.0], [404.0, 94.0], [404.0, 126.0]]
			for at in range(carets.size()):
				s.path(root, "M%s %s l6 -8 l6 8" % [carets[at][0], carets[at][1]], with({"fill": null, "stroke": accent, "width": 2.5}, appearing(still, 800.0 + at * 450.0)))
			var seal := s.group(root, {} if still else {"anims": [Scene.motion("ohUpdStamp", 700.0, 2000.0)]})
			s.circle(seal, 620, 110, 30, {"fill": null, "stroke": accent, "width": 4.0})
			s.path(seal, "M604 110 l11 11 l21 -23", {"fill": null, "stroke": accent, "width": 5.0})
		"chamber":
			var index := 0
			var radii := [60.0, 90.0, 120.0, 150.0]
			for row in range(radii.size()):
				var radius: float = radii[row]
				var count := 9 + row * 4
				for at in range(count):
					var turn := PI + (float(at) / float(count - 1)) * PI
					var lit := (at + row) % 3 == 0
					s.circle(root, 400 + cos(turn) * radius * 1.6, 170 + sin(turn) * radius, 6, with({"fill": ink if lit else accent, "fill_opacity": 0.55 if lit else 0.9}, appearing(still, 200.0 + index * 28.0, 300.0)))
					index += 1
			s.rect(root, 365, 152, 70, 18, {"fill": accent, "rx": 2})
		"gears":
			_gear(s, s.group(root, spinning(still, 8000.0)), 300, 80, 46, 12, accent)
			_gear(s, s.group(root, spinning(still, 5500.0, true)), 392, 108, 30, 8, accent)
			_gear(s, s.group(root, spinning(still, 8000.0)), 470, 70, 40, 10, accent)
			var letter := s.group(root, {} if still else {"anims": [Scene.motion("ohUpdFall", 1600.0, 1600.0, EASE, {"fall": 90.0})]})
			s.rect(letter, 568, 30, 64, 40, {"fill": ink, "rx": 3})
			s.path(letter, "M568 30 l32 22 l32 -22", {"fill": null, "stroke": ground, "width": 3.0})
			s.circle(letter, 600, 54, 7, {"fill": accent})
		"scripts":
			s.circle(root, 400, 90, 64, {"fill": accent, "fill_opacity": 0.12, "stroke": accent, "width": 2.0})
			for rx in [22.0, 44.0]:
				s.ellipse(root, 400, 90, rx, 64, {"fill": null, "stroke": ink, "stroke_opacity": 0.3})
			s.ellipse(root, 400, 90, 64, 10, {"fill": null, "stroke": ink, "stroke_opacity": 0.3})
			for at in range(SCRIPTS.size()):
				s.text(root, 60 + ((at * 47) % 680), 200, SCRIPTS[at], with({"fill": accent if at % 2 == 1 else ink, "family": "serif", "size": 20 + (at % 4) * 6, "opacity": 0.85, "anchor": "middle"}, falling(still, -220.0, 5200.0 + (at % 5) * 500.0, at * 330.0)))
		"desk":
			s.rect(root, 40, 15, 440, 150, {"fill": ink, "fill_opacity": 0.06, "rx": 6})
			for col in range(3):
				for row in range(3):
					var card := s.group(root, appearing(still, 200.0 + (col * 3 + row) * 120.0))
					s.rect(card, 60 + col * 140, 28 + row * 44, 120, 36, {"fill": ink, "fill_opacity": 0.85, "rx": 3})
					s.rect(card, 72 + col * 140, 50 + row * 44, 96, 6, {"fill": ground, "fill_opacity": 0.25, "rx": 3})
					var bar := {"fill": accent, "rx": 3, "origin": "left"}
					if not still:
						bar["anims"] = [Scene.motion("ohUpdGrow", 1400.0, 600.0 + (col * 3 + row) * 150.0, EASE)]
					s.rect(card, 72 + col * 140, 50 + row * 44, 30 + ((col + row) % 3) * 30, 6, bar)
			grid(s, root, ink, 40.0)
			var counters := [[560.0, 60.0], [610.0, 110.0], [680.0, 70.0]]
			for at in range(counters.size()):
				var x: float = counters[at][0]
				var y: float = counters[at][1]
				var counter := s.group(root, carried(still, 0.0, 30.0, 2600.0, 800.0 + at * 300.0))
				s.rect(counter, x, y, 28, 18, {"fill": accent, "stroke": ground, "width": 1.5})
				s.path(counter, "M%s %s L%s %s M%s %s L%s %s" % [x, y, x + 28, y + 18, x + 28, y, x, y + 18], {"stroke": ground, "width": 1.5})
		"workbench":
			grid(s, root, ink)
			for at in range(LANDS.size()):
				var odd := at % 2 == 1
				s.path(root, LANDS[at], {"fill": accent if odd else ink, "fill_opacity": 0.35 if odd else 0.12, "stroke": ink, "stroke_opacity": 0.35, "transform": Transform2D(0.0, Vector2(40, 0))})
			s.path(root, "M270 80 C320 70 360 120 420 110 S500 60 540 100", with({"fill": null, "stroke": accent, "dash": [8, 6], "width": 4.0}, drawn(still, 320.0, 2600.0, 400.0)))
			var stylus := s.group(root, carried(still, 0.0, 270.0, 2600.0, 400.0))
			s.line(stylus, 270, 80, 300, 30, {"stroke": ink, "cap": "round", "width": 6.0})
			s.circle(stylus, 270, 80, 5, {"fill": accent})
		"dossier":
			s.path(root, "M330 0 L470 0 L560 180 L240 180 Z", with({"fill": accent, "fill_opacity": 0.1}, pulsing(still, 3000.0)))
			s.rect(root, 290, 45, 220, 120, {"fill": ink, "fill_opacity": 0.9, "rx": 3})
			s.rect(root, 300, 33, 70, 12, {"fill": accent})
			for at in range(6):
				var row := s.group(root, {})
				s.line(row, 306, 64 + at * 16, 490 - (at % 3) * 30, 64 + at * 16, {"stroke": ground, "stroke_opacity": 0.55, "width": 3.0})
				if at % 2 == 0:
					var bar := {"fill": ground, "origin": "right"}
					if not still:
						bar["anims"] = [Scene.motion("ohUpdShrink", 1200.0, 700.0 + at * 300.0, EASE)]
					s.rect(row, 320, 59 + at * 16, 110 + (at % 3) * 20, 10, bar)
			var glass := s.group(root, carried(still, 0.0, 120.0, 3800.0, 600.0))
			s.circle(glass, 560, 120, 26, {"fill": null, "stroke": ink, "width": 5.0})
			s.line(glass, 580, 140, 606, 166, {"stroke": ink, "cap": "round", "width": 8.0})
		"devices":
			s.rect(root, 110, 30, 150, 90, {"fill": null, "rx": 6, "stroke": ink, "width": 4.0})
			s.path(root, "M90 128 H280 L266 140 H104 Z", {"fill": ink})
			_screen(s, root, 118, 38, 134, 74, 300.0, accent, still)
			s.rect(root, 367, 30, 66, 120, {"fill": null, "rx": 12, "stroke": ink, "width": 4.0})
			_screen(s, root, 375, 44, 50, 92, 700.0, accent, still)
			s.rect(root, 530, 22, 170, 100, {"fill": null, "rx": 4, "stroke": ink, "width": 4.0})
			s.path(root, "M604 122 h22 v18 h20 v6 h-62 v-6 h20 z", {"fill": ink})
			_screen(s, root, 538, 30, 154, 84, 1100.0, accent, still)
			var links := [[262.0, 75.0, 365.0], [435.0, 85.0, 528.0]]
			for at in range(links.size()):
				s.line(root, links[at][0], links[at][1], links[at][2], links[at][1], with({"stroke": accent, "dash": [4, 6], "width": 2.0}, drawn(still, 120.0, 600.0, 500.0 + at * 400.0)))
		_:
			s.line(root, 0, 120, W, 120, {"stroke": ink, "stroke_opacity": 0.4, "width": 3.0})
			var track := s.group(root, carried(still, 0.0, -400.0, 16000.0, 0.0, true))
			for at in range(14):
				s.circle(track, 60 + at * 100, 120, 6, {"fill": ink})
				s.rect(track, 23 + at * 100, 50, 74, 50, {"fill": ink, "fill_opacity": 0.85, "rx": 4})
				for row in range(3):
					s.line(track, 31 + at * 100, 62 + row * 10, 89 + at * 100 - row * 12, 62 + row * 10, {"stroke": ground, "stroke_opacity": 0.5, "width": 2.0})
			s.rect(root, 355, 43, 90, 64, with({"fill": null, "rx": 6, "stroke": accent, "width": 4.0}, pulsing(still, 1400.0)))
	return s


static func _gear(s: Scene, parent: Scene.Shape, cx: float, cy: float, r: float, teeth: int, accent: Color) -> void:
	s.circle(parent, cx, cy, r, {"fill": null, "stroke": accent, "width": 6.0})
	for at in range(teeth):
		s.rect(parent, cx - 4.5, cy - r - 10, 9, 12, {"fill": accent, "transform": rotate_about(float(at) * 360.0 / float(teeth), cx, cy)})
	s.circle(parent, cx, cy, r * 0.25, {"fill": accent})


static func _screen(s: Scene, parent: Scene.Shape, x: float, y: float, w: float, h: float, delay: float, accent: Color, still: bool) -> void:
	var lit := s.group(parent, appearing(still, delay, 700.0))
	s.rect(lit, x, y, w, h, {"fill": accent, "fill_opacity": 0.25})
	s.path(lit, "M%s %s L%s %s L%s %s L%s %s Z" % [x + w * 0.15, y + h * 0.3, x + w * 0.45, y + h * 0.2, x + w * 0.55, y + h * 0.6, x + w * 0.25, y + h * 0.75], {"fill": accent})


static func page(banner: Dictionary, update: Dictionary, ctx: Dictionary) -> Control:
	var still: bool = ctx.get("still", false)
	var narrow: bool = ctx.get("narrow", false)
	var width: float = ctx.get("width", 1440.0)
	var p := palette(banner)
	var accent: Color = p["accent"]
	var stack: String = p["font"]
	var caps: bool = p["caps"]
	var plate := UpdateKit.plate({"background": p["ground"], "border": faded(p, "55"), "radius": 10.0}, still)
	UpdateKit.brackets(plate, accent, px(0.6), px(1.5), 1.5)
	var column := UpdateKit.vbox(0)
	var height := px(9.0) if narrow else ShellFonts.clamp_vw(10.0, 22.0, 13.0, width)
	var holder := UpdateKit.frame(height, 1.0, faded(p, "44"))
	holder.add_child(scene(str(banner.get("scene", "")), p, still))
	column.add_child(UpdateKit.reveal(holder, 120.0, still))
	var body := UpdateKit.vbox(0)
	var head := UpdateKit.vbox(0)
	head.add_child(UpdateKit.text(UpdateKit.major_line(update), px(0.76), accent, stack, 700, false, 0.16, true))
	head.add_child(UpdateKit.gap(px(0.15)))
	var title_size := px(1.9) if narrow else ShellFonts.clamp_vw(2.0, 5.0, 2.9, width)
	head.add_child(UpdateKit.para(str(banner.get("title", "")), title_size, p["ink"], stack, 800, false, 1.06, 0.04 if caps else 0.0, caps))
	if not str(banner.get("subtitle", "")).is_empty():
		head.add_child(UpdateKit.gap(px(0.2)))
		head.add_child(UpdateKit.text(str(banner.get("subtitle", "")), px(1.02), accent, stack, 600))
	body.add_child(UpdateKit.reveal(head, 260.0, still))
	if not str(banner.get("lead", "")).is_empty():
		body.add_child(UpdateKit.gap(px(0.8)))
		body.add_child(UpdateKit.reveal(UpdateKit.para(str(banner.get("lead", "")), px(0.96), p["soft"], stack, 400, false, 1.55), 380.0, still))
	body.add_child(UpdateKit.rule(accent))
	body.add_child(UpdateKit.feature_cards(banner.get("sections", []), accent, p["soft"], {"background": faded(p, "0d"), "border": faded(p, "33")}, stack, caps, 480.0, still))
	if narrow:
		column.add_child(UpdateKit.margins(body, px(1.1), px(1.1), px(1.1), px(1.3)))
	else:
		column.add_child(UpdateKit.margins(body, px(2.0), px(1.4), px(2.0), px(1.7)))
	plate.add_child(column)
	return UpdateKit.plate_reveal(plate, still)
