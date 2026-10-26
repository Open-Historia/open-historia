class_name EditorWarRules
extends RefCounted

const WAR_MECHANICS := ["fatigue", "weather", "terrain", "walls", "muster", "military", "air", "supply", "attrition"]
const ERA_LABELS := ["Before 1500", "1500 to 1850", "1850 to 1945", "From 1945"]
const ERA_STARTS := [1500, 1850, 1945]
const MEN_PER_COUNTER_MOST := 1000000
const MUSTER_DAYS_MOST := 3650
const FRONTS_FROM_YEAR := 1900
const WARFARE_FORMS := ["front", "swarm"]
const MEN_PER_FORMATION_BY_ERA := [2000, 5000, 12000, 10000]
const DEFAULT_MUSTER := [[0.5, 21.0], [1.0, 90.0]]
const MUSTER_TABLE_DAYS_MOST := 730
const WAR_OUTCOMES_MOST := 24
const POPULATION_FIGURE_MOST := 20000000000.0
const MAX_ABS_YEAR := 999999
const MAX_SIDE_MEMBERS := 8
const MAX_TROOPS_PER_SIDE := 400
const MAX_COMMANDS := 8
const GENERAL_NAME_MAX := 60
const BATTLEFIELD_NAME_MAX := 80
const MAX_SCENARIO_FRONTS := 8
const SCENARIO_STANCES := ["hold", "dig in", "advance"]
const DEPLOY_FORMS := ["front", "swarm"]
const POPULATION_SCALES := {"k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "b": 1e9, "bn": 1e9, "billion": 1e9}

static var _whitespace: RegEx
static var _era_word: RegEx
static var _date_shape: RegEx
static var _year_shape: RegEx
static var _bce_shape: RegEx
static var _figure_shape: RegEx
static var _figure_strip: RegEx


static func _rx(slot: String) -> RegEx:
	match slot:
		"whitespace":
			if _whitespace == null:
				_whitespace = RegEx.create_from_string("\\s+")
			return _whitespace
		"era":
			if _era_word == null:
				_era_word = RegEx.create_from_string("(?i)\\s*(BCE|BC|CE|AD)$")
			return _era_word
		"date":
			if _date_shape == null:
				_date_shape = RegEx.create_from_string("^([+-]?)(\\d{1,6})-(\\d{1,2})-(\\d{1,2})$")
			return _date_shape
		"year":
			if _year_shape == null:
				_year_shape = RegEx.create_from_string("(-?\\d{3,4})")
			return _year_shape
		"bce":
			if _bce_shape == null:
				_bce_shape = RegEx.create_from_string("(?i)BC|BCE")
			return _bce_shape
		"figure":
			if _figure_shape == null:
				_figure_shape = RegEx.create_from_string("^(\\d+(?:\\.\\d+)?)([a-z]*)$")
			return _figure_shape
		_:
			if _figure_strip == null:
				_figure_strip = RegEx.create_from_string("[,\\s_'’]")
			return _figure_strip


static func js_string(value: Variant) -> String:
	if value == null:
		return ""
	if value is String:
		return value
	if value is bool:
		return "true" if value else "false"
	if value is float:
		return js_number(value)
	return str(value)


static func js_number(value: float) -> String:
	if is_nan(value):
		return "NaN"
	if absf(value) < 1e15 and is_equal_approx(value, roundf(value)):
		return str(int(roundf(value)))
	return String.num(value)


static func to_number(value: Variant) -> float:
	if value == null:
		return 0.0
	if value is bool:
		return 1.0 if value else 0.0
	if value is int or value is float:
		return float(value)
	if value is String:
		var text: String = (value as String).strip_edges()
		if text.is_empty():
			return 0.0
		if text.is_valid_float():
			return text.to_float()
		return NAN
	return NAN


static func is_finite_number(value: float) -> bool:
	return not is_nan(value) and not is_inf(value)


static func collapse(value: Variant, most := 200) -> String:
	var text := _rx("whitespace").sub(js_string(value), " ", true).strip_edges()
	return text.substr(0, most).strip_edges()


static func fold(value: Variant) -> String:
	return collapse(value).to_lower()


static func days_in_month(year: int, month: int) -> int:
	var astronomical := year + 1 if year < 0 else year
	var leap := astronomical % 4 == 0 and (astronomical % 100 != 0 or astronomical % 400 == 0)
	var lengths := [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	if month < 1 or month > 12:
		return 0
	return int(lengths[month - 1])


static func parse_game_date(value: Variant) -> Array:
	var raw := js_string(value).strip_edges()
	if raw.is_empty():
		return []
	var bc := false
	var era := _rx("era").search(raw)
	if era:
		bc = era.get_string(1).to_upper().begins_with("BC")
		raw = raw.substr(0, era.get_start()).strip_edges()
	var cut := raw.length()
	for separator in ["T", " "]:
		var at := raw.find(separator)
		if at >= 0 and at < cut:
			cut = at
	var date_part := raw.substr(0, cut)
	var found := _rx("date").search(date_part)
	if not found:
		return []
	var year := int(found.get_string(2))
	var month := int(found.get_string(3))
	var day := int(found.get_string(4))
	if found.get_string(1) == "-" or bc:
		year = -year
	if year == 0 or absi(year) > MAX_ABS_YEAR:
		return []
	if month < 1 or month > 12:
		return []
	if day < 1 or day > days_in_month(year, month):
		return []
	return [year, month, day]


static func compare_game_dates(a: Variant, b: Variant) -> int:
	var left := parse_game_date(a)
	var right := parse_game_date(b)
	if not left.is_empty() and not right.is_empty():
		for index in range(3):
			if int(left[index]) != int(right[index]):
				return -1 if int(left[index]) < int(right[index]) else 1
		return 0
	if not left.is_empty():
		return -1
	if not right.is_empty():
		return 1
	return js_string(a).strip_edges().naturalcasecmp_to(js_string(b).strip_edges())


static func game_date_year(value: Variant) -> Variant:
	var parsed := parse_game_date(value)
	return null if parsed.is_empty() else int(parsed[0])


static func _era_count(year: int) -> int:
	var count := 0
	for start in ERA_STARTS:
		if year >= int(start):
			count += 1
	return count


static func whole_era(value: Variant) -> Variant:
	if value == null:
		return null
	if value is int:
		return value if value >= 0 and value <= 3 else null
	if value is float and is_equal_approx(value, roundf(value)) and value >= 0.0 and value <= 3.0:
		return int(roundf(value))
	return null


static func era_of(game_date: Variant, era: Variant = null) -> int:
	var set_era: Variant = whole_era(era)
	if set_era != null:
		return int(set_era)
	var parsed := parse_game_date(game_date)
	if not parsed.is_empty():
		return _era_count(int(parsed[0]))
	var text := js_string(game_date)
	var found := _rx("year").search(text)
	var bce := _rx("bce").search(text) != null
	var year := int(found.get_string(1)) * (-1 if bce else 1) if found else 2000
	return _era_count(year)


static func _number_in(value: Variant, least: float, most: float) -> Variant:
	if value == null or (value is String and (value as String).is_empty()):
		return null
	var number := to_number(value)
	if is_finite_number(number) and number >= least and number <= most:
		return number
	return null


static func normalize_era(value: Variant) -> Variant:
	var era: Variant = _number_in(value, 0.0, 3.0)
	if era == null or not is_equal_approx(float(era), roundf(float(era))):
		return null
	return int(roundf(float(era)))


static func normalize_muster_points(value: Variant) -> Variant:
	if not (value is Array) or (value as Array).size() < 2:
		return null
	var points: Array = []
	for index in range(2):
		var point: Variant = (value as Array)[index]
		var share: Variant = _number_in(point[0] if point is Array and (point as Array).size() > 0 else NAN, 0.001, 1.0)
		var days: Variant = _number_in(point[1] if point is Array and (point as Array).size() > 1 else NAN, 0.1, float(MUSTER_DAYS_MOST))
		if share == null or days == null:
			return null
		points.append([float(share), float(days)])
	points.sort_custom(func(a: Array, b: Array) -> bool: return float(a[0]) < float(b[0]))
	if float(points[1][0]) - float(points[0][0]) < 0.001 or float(points[1][1]) <= float(points[0][1]):
		return null
	var out: Array = []
	for point in points:
		out.append([roundf(float(point[0]) * 1000.0) / 1000.0, roundf(float(point[1]) * 10.0) / 10.0])
	return out


static func normalize_warfare(value: Variant) -> Variant:
	if value is String and WARFARE_FORMS.has(value):
		return value
	return null


static func normalize_war_outcomes(value: Variant) -> Array:
	var kept: Array = []
	var seen := {}
	if not (value is Array):
		return kept
	for raw in value:
		if not (raw is Dictionary):
			continue
		var winner := collapse((raw as Dictionary).get("winner"), 120)
		var loser := collapse((raw as Dictionary).get("loser"), 120)
		if winner.is_empty() or loser.is_empty() or winner.to_lower() == loser.to_lower():
			continue
		var key := winner.to_lower() + "\u0001" + loser.to_lower()
		if seen.has(key):
			continue
		seen[key] = true
		kept.append({"winner": winner, "loser": loser})
		if kept.size() >= WAR_OUTCOMES_MOST:
			break
	return kept


static func normalize_war_settings(value: Variant) -> Variant:
	if not (value is Dictionary):
		return null
	var source: Dictionary = value
	var mechanics := {}
	var given: Variant = source.get("mechanics")
	for key in WAR_MECHANICS:
		if given is Dictionary and (given as Dictionary).get(key) is bool:
			mechanics[key] = (given as Dictionary)[key]
	var men: Variant = _number_in(source.get("menPerCounter"), 1.0, float(MEN_PER_COUNTER_MOST))
	var share: Variant = _number_in(source.get("manpowerShare"), 1.0, 100.0)
	var outcomes := normalize_war_outcomes(source.get("outcomes"))
	var kept := {
		"mechanics": mechanics,
		"era": normalize_era(source.get("era")),
		"menPerCounter": null if men == null else int(roundf(float(men))),
		"manpowerShare": null if share == null else roundf(float(share) * 10.0) / 10.0,
		"muster": normalize_muster_points(source.get("muster")),
	}
	if not outcomes.is_empty():
		kept["outcomes"] = outcomes
	var warfare: Variant = normalize_warfare(source.get("warfare"))
	if warfare != null:
		kept["warfare"] = warfare
	return kept


static func compact_war_settings(value: Variant) -> Variant:
	var kept: Variant = normalize_war_settings(value)
	if kept == null:
		return null
	var mechanics := {}
	for key in (kept["mechanics"] as Dictionary):
		if (kept["mechanics"] as Dictionary)[key] == false:
			mechanics[key] = false
	var compact := {
		"mechanics": mechanics,
		"era": kept["era"],
		"menPerCounter": kept["menPerCounter"],
		"manpowerShare": kept["manpowerShare"],
		"muster": kept["muster"],
	}
	if (kept as Dictionary).has("outcomes"):
		compact["outcomes"] = kept["outcomes"]
	if (kept as Dictionary).has("warfare"):
		compact["warfare"] = kept["warfare"]
	var empty := mechanics.is_empty() and compact["era"] == null and compact["menPerCounter"] == null and compact["manpowerShare"] == null and compact["muster"] == null and not compact.has("outcomes") and not compact.has("warfare")
	return null if empty else compact


static func _empty_settings() -> Dictionary:
	return {"mechanics": {}, "era": null, "menPerCounter": null, "manpowerShare": null, "muster": null, "warfare": null}


static func with_war_settings(value: Variant, patch: Dictionary) -> Variant:
	var merged := _empty_settings()
	var kept: Variant = normalize_war_settings(value)
	if kept != null:
		for key in (kept as Dictionary):
			merged[key] = (kept as Dictionary)[key]
	for key in patch:
		merged[key] = patch[key]
	return compact_war_settings(merged)


static func with_war_outcome(value: Variant, winner: String, loser: String) -> Variant:
	var kept: Variant = normalize_war_settings(value)
	var outcomes: Array = ((kept as Dictionary).get("outcomes", []) as Array).duplicate(true) if kept != null else []
	outcomes.append({"winner": winner, "loser": loser})
	return with_war_settings(value, {"outcomes": outcomes})


static func without_war_outcome(value: Variant, index: int) -> Variant:
	var kept: Variant = normalize_war_settings(value)
	var outcomes: Array = ((kept as Dictionary).get("outcomes", []) as Array) if kept != null else []
	var rest: Array = []
	for at in range(outcomes.size()):
		if at != index:
			rest.append(outcomes[at])
	return with_war_settings(value, {"outcomes": rest})


static func with_war_mechanic(value: Variant, key: String, on: bool) -> Variant:
	var kept: Variant = normalize_war_settings(value)
	var base: Dictionary = (kept as Dictionary).duplicate(true) if kept != null else _empty_settings()
	var mechanics: Dictionary = (base.get("mechanics", {}) as Dictionary).duplicate()
	mechanics[key] = on
	base["mechanics"] = mechanics
	return compact_war_settings(base)


static func war_number_text(value: Variant, key: String) -> String:
	var kept: Variant = normalize_war_settings(value)
	if kept == null:
		return ""
	var number: Variant = (kept as Dictionary).get(key)
	if number == null:
		return ""
	return format_population_figure(number) if key == "menPerCounter" else js_number(float(number))


static func with_war_number(value: Variant, key: String, text: String) -> Dictionary:
	var raw := text.strip_edges()
	if raw.is_empty():
		return {"settings": with_war_settings(value, {key: null}), "ok": true}
	var number := 0.0
	if key == "menPerCounter":
		number = read_population_figure(raw)
	else:
		var cleaned := RegEx.create_from_string("\\s*%$").sub(raw, "").replace(",", ".")
		number = to_number(cleaned) if not cleaned.strip_edges().is_empty() else 0.0
	if not is_finite_number(number) or number <= 0.0:
		return {"settings": compact_war_settings(value), "ok": false}
	var held := clampf(roundf(number), 1.0, float(MEN_PER_COUNTER_MOST)) if key == "menPerCounter" else clampf(number, 1.0, 100.0)
	return {"settings": with_war_settings(value, {key: held}), "ok": true}


static func warfare_of(war_settings: Variant, date: Variant) -> String:
	var kept: Variant = normalize_war_settings(war_settings)
	if kept != null and (kept as Dictionary).has("warfare"):
		return str(kept["warfare"])
	var year: Variant = game_date_year(date)
	if year != null:
		return "swarm" if int(year) < FRONTS_FROM_YEAR else "front"
	if kept != null and kept["era"] != null and int(kept["era"]) < 2:
		return "swarm"
	return "front"


static func read_population_figure(value: Variant) -> float:
	if value is int or value is float:
		var count := float(value)
		return minf(POPULATION_FIGURE_MOST, roundf(count)) if is_finite_number(count) and count >= 1.0 else 0.0
	var text := _rx("strip").sub(js_string(value).strip_edges().to_lower(), "", true)
	var found := _rx("figure").search(text)
	if not found:
		return 0.0
	var scale := 1.0
	if not found.get_string(2).is_empty():
		if not POPULATION_SCALES.has(found.get_string(2)):
			return 0.0
		scale = float(POPULATION_SCALES[found.get_string(2)])
	var people := found.get_string(1).to_float() * scale
	return minf(POPULATION_FIGURE_MOST, roundf(people)) if is_finite_number(people) and people >= 1.0 else 0.0


static func group_digits(whole: int) -> String:
	var digits := str(absi(whole))
	var out := ""
	var count := 0
	for index in range(digits.length() - 1, -1, -1):
		out = digits[index] + out
		count += 1
		if count % 3 == 0 and index > 0:
			out = "," + out
	return ("-" if whole < 0 else "") + out


static func format_population_figure(value: Variant) -> String:
	var people := read_population_figure(value)
	return group_digits(int(people)) if people > 0.0 else ""


static func expm1(x: float) -> float:
	if absf(x) < 1e-5:
		return x + x * x / 2.0 + x * x * x / 6.0
	return exp(x) - 1.0


static func _muster_valid(points: Variant) -> bool:
	if not (points is Array) or (points as Array).size() != 2:
		return false
	for point in points:
		if not (point is Array) or (point as Array).size() < 2:
			return false
		if not (float(point[0]) > 0.0 and float(point[0]) <= 1.0 and float(point[1]) > 0.0):
			return false
	return float(points[1][0]) > float(points[0][0]) and float(points[1][1]) > float(points[0][1])


static func fit_muster(points: Variant) -> Dictionary:
	var source: Array = points if _muster_valid(points) else DEFAULT_MUSTER
	var p1 := float(source[0][0])
	var d1 := float(source[0][1])
	var p2 := float(source[1][0])
	var d2 := float(source[1][1])
	var wanted := d2 / d1
	var straight := p2 / p1
	if absf(wanted - straight) < 1e-9:
		return {"A": d1 / p1, "B": 0.0}
	var low := 0.0 if wanted > straight else -60.0
	var high := 60.0 if wanted > straight else 0.0
	for step in range(200):
		var middle := (low + high) / 2.0
		var ratio := straight if absf(middle) < 1e-12 else expm1(middle * p2) / expm1(middle * p1)
		if ratio < wanted:
			low = middle
		else:
			high = middle
	var b := (low + high) / 2.0
	return {"A": d1 / expm1(b * p1), "B": b}


static func muster_days(curve: Dictionary, share: float) -> float:
	var b := float(curve["B"])
	return float(curve["A"]) * share if b == 0.0 else float(curve["A"]) * expm1(b * share)


static func muster_table(points: Variant) -> PackedFloat64Array:
	var curve := fit_muster(points)
	var a := float(curve["A"])
	var b := float(curve["B"])
	var table := PackedFloat64Array([0.0])
	for day in range(1, MUSTER_TABLE_DAYS_MOST + 1):
		var share := 0.0
		if b == 0.0:
			share = float(day) / a
		else:
			var inside := 1.0 + float(day) / a
			share = log(inside) / b if inside > 0.0 else 1.0
		var value := roundf(minf(1.0, maxf(table[day - 1], share)) * 1e4) / 1e4
		table.append(value)
		if value >= 1.0:
			break
	return table


static func muster_curve_points(points: Variant, count := 48) -> Array:
	var curve := fit_muster(points)
	var out: Array = []
	for index in range(count + 1):
		var part := float(index) / float(count)
		out.append([roundf(muster_days(curve, part) * 10.0) / 10.0, part])
	return out


static func all_in_day(points: Variant) -> int:
	var table := muster_table(points)
	return table.size() - 1 if table[table.size() - 1] >= 1.0 else table.size()


static func _members(value: Variant, taken: Dictionary) -> Array:
	var names: Array = []
	if not (value is Array):
		return names
	for raw in value:
		var name := collapse(raw, 120)
		if name.is_empty() or taken.has(name.to_lower()):
			continue
		var duplicate := false
		for other in names:
			if str(other).to_lower() == name.to_lower():
				duplicate = true
				break
		if duplicate:
			continue
		names.append(name)
		if names.size() >= MAX_SIDE_MEMBERS:
			break
	return names


static func _at(value: Variant, index: int) -> Variant:
	if value is Array and index < (value as Array).size():
		return (value as Array)[index]
	return null


static func normalize_front(raw: Variant, draft := false) -> Variant:
	if not (raw is Dictionary):
		return null
	var source: Dictionary = raw
	var war: bool = source.get("war") != false
	var sides_value: Variant = source.get("sides")
	var side_a := _members(_at(sides_value, 0), {})
	var taken := {}
	for name in side_a:
		taken[str(name).to_lower()] = true
	var side_b := _members(_at(sides_value, 1), taken)
	var sides: Array = [side_a, side_b] if war else [side_a.slice(0, 1), side_b.slice(0, 1)]
	if not draft and ((sides[0] as Array).is_empty() or (sides[1] as Array).is_empty()):
		return null
	var stance: Array = []
	var forms: Array = []
	var troops: Array = []
	var generals: Array = []
	var any_form := false
	for side in range(2):
		var word := fold(_at(source.get("stance"), side))
		if not SCENARIO_STANCES.has(word):
			stance.append("hold")
		else:
			stance.append("hold" if not war and word == "advance" else word)
		var form := fold(_at(source.get("forms"), side))
		forms.append(form if DEPLOY_FORMS.has(form) else "")
		if DEPLOY_FORMS.has(form):
			any_form = true
		var count := to_number(_at(source.get("troops"), side))
		if not is_finite_number(count):
			count = 0.0
		troops.append(int(clampf(roundf(count), 0.0, float(MAX_TROOPS_PER_SIDE))))
		var names: Array = []
		var given: Variant = _at(source.get("generals"), side)
		if given is Array:
			for entry in (given as Array).slice(0, MAX_COMMANDS):
				names.append(collapse(entry, GENERAL_NAME_MAX))
		generals.append(names)
	var front := {
		"name": collapse(source.get("name"), BATTLEFIELD_NAME_MAX),
		"sides": sides,
		"war": war,
		"troops": troops,
		"stance": stance,
		"generals": generals,
	}
	if any_form:
		front["forms"] = forms
	return front


static func normalize_scenario_fronts(value: Variant, draft := false) -> Array:
	var fronts: Array = []
	if not (value is Array):
		return fronts
	for raw in value:
		var front: Variant = normalize_front(raw, draft)
		if front != null:
			fronts.append(front)
		if fronts.size() >= MAX_SCENARIO_FRONTS:
			break
	return fronts


static func blank_front() -> Dictionary:
	return {"name": "", "sides": [[], []], "war": true, "troops": [0, 0], "stance": ["hold", "hold"], "generals": [[], []]}


static func same_json(a: Variant, b: Variant) -> bool:
	return JSON.stringify(_canonical(a)) == JSON.stringify(_canonical(b))


static func _canonical(value: Variant) -> Variant:
	if value is Dictionary:
		var out := {}
		var keys: Array = (value as Dictionary).keys()
		keys.sort()
		for key in keys:
			out[key] = _canonical((value as Dictionary)[key])
		return out
	if value is Array:
		var items: Array = []
		for entry in value:
			items.append(_canonical(entry))
		return items
	if value is int:
		return float(value)
	return value
