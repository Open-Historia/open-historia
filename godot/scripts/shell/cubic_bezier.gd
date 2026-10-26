class_name CubicBezier
extends RefCounted

static var _named := {}
static var _pattern: RegEx

var x1 := 0.0
var y1 := 0.0
var x2 := 1.0
var y2 := 1.0


func _init(a := 0.0, b := 0.0, c := 1.0, d := 1.0) -> void:
	x1 = a
	y1 = b
	x2 = c
	y2 = d


static func named(timing: String) -> CubicBezier:
	var key := timing.strip_edges().to_lower()
	if _named.has(key):
		return _named[key]
	var curve: CubicBezier
	match key:
		"linear":
			curve = CubicBezier.new(0.0, 0.0, 1.0, 1.0)
		"ease":
			curve = CubicBezier.new(0.25, 0.1, 0.25, 1.0)
		"ease-in":
			curve = CubicBezier.new(0.42, 0.0, 1.0, 1.0)
		"ease-out":
			curve = CubicBezier.new(0.0, 0.0, 0.58, 1.0)
		"ease-in-out":
			curve = CubicBezier.new(0.42, 0.0, 0.58, 1.0)
		_:
			if not _pattern:
				_pattern = RegEx.create_from_string("cubic-bezier\\(\\s*([-+.\\deE]+)\\s*,\\s*([-+.\\deE]+)\\s*,\\s*([-+.\\deE]+)\\s*,\\s*([-+.\\deE]+)\\s*\\)")
			var found := _pattern.search(key)
			if found:
				curve = CubicBezier.new(float(found.get_string(1)), float(found.get_string(2)), float(found.get_string(3)), float(found.get_string(4)))
			else:
				curve = CubicBezier.new(0.25, 0.1, 0.25, 1.0)
	_named[key] = curve
	return curve


static func _along(a: float, b: float, s: float) -> float:
	return 3.0 * a * (1.0 - s) * (1.0 - s) * s + 3.0 * b * (1.0 - s) * s * s + s * s * s


static func _slope(a: float, b: float, s: float) -> float:
	return 3.0 * a * (1.0 - s) * (1.0 - s) + 6.0 * (b - a) * (1.0 - s) * s + 3.0 * (1.0 - b) * s * s


func at(t: float) -> float:
	if not (t > 0.0):
		return 0.0
	if t >= 1.0:
		return 1.0
	if x1 == y1 and x2 == y2:
		return t
	var s := t
	for step in range(8):
		var off := _along(x1, x2, s) - t
		if absf(off) < 1e-7:
			break
		var rate := _slope(x1, x2, s)
		if absf(rate) < 1e-7:
			break
		s -= off / rate
	if not (s >= 0.0 and s <= 1.0) or absf(_along(x1, x2, s) - t) > 1e-5:
		var low := 0.0
		var high := 1.0
		for step in range(50):
			s = (low + high) / 2.0
			if _along(x1, x2, s) < t:
				low = s
			else:
				high = s
	return _along(y1, y2, s)


static func animate(owner: Node, apply: Callable, duration_ms: float, delay_ms := 0.0, timing := "ease", backwards := true) -> Tween:
	var curve := CubicBezier.named(timing)
	if backwards:
		apply.call(0.0)
	var tween := owner.create_tween()
	if delay_ms > 0.0:
		tween.tween_interval(delay_ms / 1000.0)
	tween.tween_method(func(t: float) -> void: apply.call(curve.at(t)), 0.0, 1.0, maxf(0.001, duration_ms / 1000.0))
	return tween
