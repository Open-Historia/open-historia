class_name EditorFeaturesModel
extends RefCounted

const OPERATORS := ["all", "any", "at_least"]
const CONDITION_KEYS := ["polityId", "warId", "institutionId", "overlordId", "eventId", "outcomeId", "regionId", "baseOwner", "status", "kind"]
const JS_SPACE := [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279]

static var _res := {}


static func _re(pattern: String) -> RegEx:
	if not _res.has(pattern):
		_res[pattern] = RegEx.create_from_string(pattern)
	return _res[pattern]


static func is_js_space(code: int) -> bool:
	return JS_SPACE.has(code)


static func js_trim(text: String) -> String:
	var start := 0
	var finish := text.length()
	while start < finish and is_js_space(text.unicode_at(start)):
		start += 1
	while finish > start and is_js_space(text.unicode_at(finish - 1)):
		finish -= 1
	return text.substr(start, finish - start)


static func js_string(value: Variant) -> String:
	if value == null:
		return "null"
	if value is bool:
		return "true" if value else "false"
	if value is float or value is int:
		return number_text(float(value))
	if value is String or value is StringName:
		return str(value)
	if value is Array:
		var parts: PackedStringArray = []
		for item in value:
			parts.append("" if item == null else js_string(item))
		return ",".join(parts)
	if value is Dictionary:
		return "[object Object]"
	return str(value)


static func text_of(value: Variant) -> String:
	return "" if value == null else js_string(value)


static func number_text(number: float) -> String:
	if is_nan(number):
		return "NaN"
	if is_inf(number):
		return "Infinity" if number > 0 else "-Infinity"
	if number == floorf(number) and absf(number) < 1e21:
		return "%d" % int(number) if absf(number) < 9.2e18 else String.num(number, 0)
	var text := String.num(number, 15)
	if text.contains("."):
		text = text.rstrip("0").rstrip(".")
	return text


static func js_number(value: Variant) -> float:
	if value == null:
		return 0.0
	if value is bool:
		return 1.0 if value else 0.0
	if value is float or value is int:
		return float(value)
	if value is String or value is StringName:
		var text := js_trim(str(value))
		if text.is_empty():
			return 0.0
		var lower := text.to_lower()
		if lower.begins_with("0x") and text.length() > 2 and _re("^0[xX][0-9a-fA-F]+$").search(text):
			return float(text.substr(2).hex_to_int())
		if lower.begins_with("0b") and _re("^0[bB][01]+$").search(text):
			return float(text.substr(2).bin_to_int())
		if lower.begins_with("0o") and _re("^0[oO][0-7]+$").search(text):
			var total := 0.0
			for index in range(2, text.length()):
				total = total * 8.0 + float(text.unicode_at(index) - 48)
			return total
		if text == "Infinity" or text == "+Infinity":
			return INF
		if text == "-Infinity":
			return -INF
		if _re("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$").search(text):
			return text.to_float()
		return NAN
	if value is Array:
		var items: Array = value
		if items.is_empty():
			return 0.0
		if items.size() == 1:
			return js_number(text_of(items[0]))
		return NAN
	return NAN


static func number_or_nan(source: Dictionary, key: String) -> float:
	return js_number(source[key]) if source.has(key) else NAN


static func is_finite_number(number: float) -> bool:
	return not is_nan(number) and not is_inf(number)


static func js_round(number: float) -> float:
	return floorf(number + 0.5)


static func js_trunc(number: float) -> float:
	return number - fmod(number, 1.0)


static func coalesce(source: Dictionary, keys: Array) -> Variant:
	for key in keys:
		if source.has(key) and source[key] != null:
			return source[key]
	return null


static func read_boolean(value: Variant) -> Variant:
	if value is bool:
		return value
	if value is float or value is int:
		return float(value) != 0.0
	if value is String:
		var text := js_trim(str(value)).to_lower()
		if ["true", "on", "yes", "enabled", "1"].has(text):
			return true
		if ["false", "off", "no", "disabled", "0"].has(text):
			return false
	return null


static func date_key(iso: Variant) -> Variant:
	var match := _re("^(-?)(\\d{1,4})-(\\d{2})-(\\d{2})$").search(js_trim(text_of(iso)))
	if match == null:
		return null
	var value := int(match.get_string(2)) * 10000 + int(match.get_string(3)) * 100 + int(match.get_string(4))
	return -value if not match.get_string(1).is_empty() else value


static func utf16_units(text: String) -> PackedInt32Array:
	var units := PackedInt32Array()
	for index in range(text.length()):
		var code := text.unicode_at(index)
		if code > 0xFFFF:
			var rest := code - 0x10000
			units.append(0xD800 + (rest >> 10))
			units.append(0xDC00 + (rest & 0x3FF))
		else:
			units.append(code)
	return units


static func base36(number: int) -> String:
	if number == 0:
		return "0"
	var digits := "0123456789abcdefghijklmnopqrstuvwxyz"
	var out := ""
	var rest := number
	while rest > 0:
		out = digits[rest % 36] + out
		rest = rest / 36
	return out


static func scripted_hash(value: String) -> String:
	var hash := 2166136261
	for unit in utf16_units(value):
		hash = hash ^ unit
		hash = (hash * 16777619) & 0xFFFFFFFF
	return base36(hash)


static func scripted_id(value: Variant, seed: String) -> String:
	var explicit := js_trim(text_of(value)).to_lower()
	explicit = _re("[^a-z0-9._:-]+").sub(explicit, "-", true)
	explicit = _re("^-+|-+$").sub(explicit, "", true)
	explicit = explicit.substr(0, 120)
	return explicit if not explicit.is_empty() else "scripted-" + scripted_hash(seed)


static func collapse_spaces(text: String) -> String:
	return js_trim(_re("\\s+").sub(text, " ", true))


static func scripted_title(body: Variant) -> String:
	var text := collapse_spaces(text_of(body))
	var sentence := _re("^(.{12,140}?[.!?])\\s").search(text + " ")
	var title := (sentence.get_string(1) if sentence else text).substr(0, 140)
	return _re("[.!?]$").sub(title, "", false)


static func normalize_condition(value: Variant) -> Variant:
	if not (value is Dictionary):
		return null
	var source: Dictionary = value
	var type := js_trim(text_of(source.get("type"))).to_lower()
	if type.is_empty():
		return null
	var out := {"type": type.substr(0, 80)}
	for key in CONDITION_KEYS:
		var token := js_trim(text_of(source.get(key))).substr(0, 160)
		if not token.is_empty():
			out[key] = token
	return out


static func scripted_percent(number: float, fallback: float) -> float:
	return clampf(number, 0.0, 100.0) if is_finite_number(number) else fallback


static func rule_group(source: Dictionary) -> Dictionary:
	var conditions: Array = []
	var raw: Variant = source.get("conditions")
	if raw is Array:
		for entry in raw:
			var normalized: Variant = normalize_condition(entry)
			if normalized != null and conditions.size() < 24:
				conditions.append(normalized)
	var raw_operator := js_trim(text_of(source.get("operator") if source.get("operator") != null else "all")).to_lower().replace("-", "_")
	var operator := raw_operator if OPERATORS.has(raw_operator) else "all"
	var wanted: Variant = coalesce(source, ["requiredCount", "minimum"])
	var requested := js_number(wanted) if wanted != null else 1.0
	var required := 0.0
	if not conditions.is_empty():
		required = maxf(1.0, minf(float(conditions.size()), js_trunc(requested) if is_finite_number(requested) else 1.0))
	var group := {"operator": operator}
	if operator == "at_least":
		group["requiredCount"] = required
	group["conditions"] = conditions
	return group


static func normalize_trigger(value: Variant) -> Dictionary:
	var source: Dictionary = value if value is Dictionary else {}
	var mode_value: Variant = source.get("mode")
	var mode := js_trim(text_of(mode_value if mode_value != null else "always")).to_lower()
	if mode == "rules":
		var trigger := {"mode": "rules"}
		trigger.merge(rule_group(source))
		var percent_value: Variant = coalesce(source, ["percent", "chancePercent"])
		var percent_number := NAN
		if percent_value != null:
			percent_number = js_number(percent_value)
		elif source.has("chancePercent"):
			percent_number = js_number(null)
		trigger["percent"] = scripted_percent(percent_number, 100.0)
		return trigger
	if mode == "chance":
		return {"mode": "rules", "operator": "all", "conditions": [], "percent": scripted_percent(number_or_nan(source, "percent"), 50.0)}
	if mode == "conditional":
		var group := rule_group(source)
		if (group["conditions"] as Array).is_empty():
			return {"mode": "invalid"}
		var conditional := {"mode": "rules"}
		conditional.merge(group)
		conditional["percent"] = 100.0
		return conditional
	var truthy: bool = mode_value != null and not (mode_value is String and str(mode_value).is_empty()) and not (mode_value is bool and not mode_value) and not ((mode_value is float or mode_value is int) and float(mode_value) == 0.0)
	if mode == "always" or not truthy:
		return {"mode": "rules", "operator": "all", "conditions": [], "percent": 100.0}
	var kept := mode.substr(0, 32)
	return {"mode": kept if not kept.is_empty() else "invalid"}


static func outcome_weight(number: float, fallback: float) -> float:
	return clampf(number, 0.0, 1000000.0) if is_finite_number(number) else fallback


static func text_mode(value: Variant) -> String:
	return "exact" if js_trim(text_of(value)).to_lower() == "exact" else "generated"


static func _body_of(entry: Dictionary) -> String:
	var raw: Variant = coalesce(entry, ["text", "description"])
	return js_trim(text_of(raw).replace("\r\n", "\n")).substr(0, 4000)


static func _title_of(entry: Dictionary, body: String) -> String:
	var title := collapse_spaces(text_of(entry.get("title"))).substr(0, 140)
	return title if not title.is_empty() else scripted_title(body)


static func normalize_outcomes(value: Variant, parent_id: String) -> Array:
	if not (value is Array):
		return []
	var source: Array = value
	var ids := {}
	var outcomes: Array = []
	for index in range(source.size()):
		if outcomes.size() >= 24:
			break
		var entry: Variant = source[index]
		if not (entry is Dictionary):
			continue
		var record: Dictionary = entry
		var body := _body_of(record)
		if body.is_empty():
			continue
		var base_id := scripted_id(record.get("id"), "%s|outcome|%s|%d" % [parent_id, body, index])
		var seen := int(ids.get(base_id, 0))
		ids[base_id] = seen + 1
		var id := ("%s-%d" % [base_id, seen + 1]).substr(0, 160) if seen > 0 else base_id
		outcomes.append({"id": id, "title": _title_of(record, body), "text": body, "weight": outcome_weight(number_or_nan(record, "weight"), 1.0)})
	return outcomes


static func _parse_lines(text: String) -> Array:
	var parsed: Array = []
	var lines := _re("\\r?\\n").sub(text, "\n", true).split("\n")
	for index in range(lines.size()):
		var line := js_trim(lines[index])
		if line.is_empty() or line.begins_with("#"):
			continue
		var match := _re("^\\s*(-?\\d{1,4}-\\d{2}-\\d{2})\\s*(?:[\\x{2014}\\x{2013}\\-:|]+\\s*)?(.*)$").search(line)
		if match == null or date_key(match.get_string(1)) == null:
			continue
		var body := js_trim(match.get_string(2))
		if body.is_empty():
			continue
		parsed.append({
			"id": scripted_id("", "%s|%s|%d" % [match.get_string(1), body, index]),
			"date": match.get_string(1),
			"title": scripted_title(body),
			"text": body,
			"textMode": "generated",
			"trigger": {"mode": "rules", "operator": "all", "conditions": [], "percent": 100.0},
		})
	return parsed


static func normalize_scripted_events(value: Variant) -> Array:
	var source: Variant = value
	if source is String:
		source = _parse_lines(str(source))
	if not (source is Array):
		return []
	var entries: Array = source
	var ids := {}
	var events: Array = []
	for index in range(entries.size()):
		var entry: Variant = entries[index]
		if not (entry is Dictionary):
			continue
		var record: Dictionary = entry
		var date := js_trim(text_of(record.get("date")))
		var body := _body_of(record)
		if date_key(date) == null or body.is_empty():
			continue
		var base_id := scripted_id(record.get("id"), "%s|%s|%d" % [date, body, index])
		var seen := int(ids.get(base_id, 0))
		ids[base_id] = seen + 1
		var id := ("%s-%d" % [base_id, seen + 1]).substr(0, 160) if seen > 0 else base_id
		var outcomes := normalize_outcomes(record.get("outcomes"), id)
		var mode_value: Variant = coalesce(record, ["textMode", "wordingMode", "presentationMode"])
		var event := {
			"id": id,
			"date": date,
			"title": _title_of(record, body),
			"text": body,
			"textMode": text_mode(mode_value),
			"trigger": normalize_trigger(record.get("trigger")),
		}
		if not outcomes.is_empty():
			event["outcomes"] = outcomes
		events.append(event)
	var order: Array = []
	for index in range(events.size()):
		order.append([int(date_key((events[index] as Dictionary)["date"])), index])
	order.sort_custom(func(a: Array, b: Array) -> bool:
		if int(a[0]) != int(b[0]):
			return int(a[0]) < int(b[0])
		return int(a[1]) < int(b[1]))
	var sorted: Array = []
	for pair in order:
		sorted.append(events[int(pair[1])])
	return sorted


static func read_setting(value: Variant, setting: Dictionary) -> Variant:
	var type := str(setting.get("type", ""))
	if type == "scripted-events":
		if value is String and js_trim(str(value)).is_empty():
			return null
		if not (value is Array) and not (value is String):
			return null
		return normalize_scripted_events(value)
	if type == "choice":
		var text := js_trim(text_of(value)).to_lower()
		for option in setting.get("options", []):
			if str((option as Dictionary).get("value", "")) == text:
				return text
		return null
	if type == "text":
		if not (value is String):
			return null
		var limit := int(setting.get("maxLength", 0))
		var trimmed := js_trim(str(value).replace("\r\n", "\n")).substr(0, limit if limit > 0 else 2000)
		return trimmed if not trimmed.is_empty() else null
	if value == null or (value is String and str(value).is_empty()):
		return null
	var number := js_number(value)
	if not is_finite_number(number):
		return null
	var clamped := minf(float(setting.get("max", 0)), maxf(float(setting.get("min", 0)), number))
	return js_round(clamped) if float(setting.get("step", 1)) >= 1.0 else clamped


static func read_entry(entry: Variant) -> Dictionary:
	return entry if entry is Dictionary else {"enabled": entry}


static func default_of(setting: Dictionary) -> Variant:
	var value: Variant = setting.get("defaultValue")
	if value is Array or value is Dictionary:
		return value.duplicate(true)
	return value


static func normalize_settings(raw: Variant, defs: Array) -> Dictionary:
	var source: Dictionary = raw if raw is Dictionary else {}
	var settings := {}
	for definition in defs:
		var def: Dictionary = definition
		var key := str(def["key"])
		var entry := read_entry(source.get(key))
		var enabled: Variant = read_boolean(entry.get("enabled"))
		var resolved := {"enabled": true if def.get("toggleable", true) == false else (enabled if enabled != null else true)}
		for item in def.get("settings", []):
			var setting: Dictionary = item
			var read: Variant = read_setting(entry.get(str(setting["key"])), setting)
			resolved[str(setting["key"])] = read if read != null else default_of(setting)
		settings[key] = resolved
	return settings


static func normalize_overrides(raw: Variant, defs: Array) -> Dictionary:
	var source: Dictionary = raw if raw is Dictionary else {}
	var overrides := {}
	for definition in defs:
		var def: Dictionary = definition
		var key := str(def["key"])
		if not source.has(key) or source[key] == null:
			continue
		var entry := read_entry(source[key])
		var resolved := {}
		var enabled: Variant = null if def.get("toggleable", true) == false else read_boolean(entry.get("enabled"))
		if enabled != null:
			resolved["enabled"] = enabled
		for item in def.get("settings", []):
			var setting: Dictionary = item
			var read: Variant = read_setting(entry.get(str(setting["key"])), setting)
			if read != null:
				resolved[str(setting["key"])] = read
		if not resolved.is_empty():
			overrides[key] = resolved
	return overrides


static func resolve(scenario_features: Variant, game_features: Variant, defs: Array) -> Dictionary:
	var base := normalize_settings(scenario_features, defs)
	var overrides := normalize_overrides(game_features, defs)
	var resolved := {}
	for definition in defs:
		var key := str((definition as Dictionary)["key"])
		var merged: Dictionary = (base[key] as Dictionary).duplicate()
		merged.merge(overrides.get(key, {}), true)
		resolved[key] = merged
	return resolved
