class_name PhraseBook
extends RefCounted

const SLOT := "\\{\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\}\\}"
const STRONG_LETTERS := 8
const WEAK_MAX_VALUE_WORDS := 4
const SENTENCE_LETTERS := 16
const MEMO_LIMIT := 5000
const LIST_SEPARATOR := " [/·•|] "
const MONTHS: Array[String] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MONTHS_SHORT: Array[String] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

static var _expressions := {}
static var _shapes: Array = []

var exact := {}
var pattern_entries := {}
var date_styles := {}
var _patterns: Array = []
var _compiled := false
var _memo := {}


static func rx(source: String) -> RegEx:
	if _expressions.has(source):
		return _expressions[source]
	var compiled := RegEx.create_from_string(source)
	_expressions[source] = compiled
	return compiled


static func collapse(text: String) -> String:
	return rx("\\s+").sub(text, " ", true).strip_edges()


static func letter_count(text: String) -> int:
	return rx("\\p{L}").search_all(text).size()


static func word_count(text: String) -> int:
	return rx("[\\p{L}\\p{N}]+").search_all(text).size()


static func escape_regex(text: String) -> String:
	var out := ""
	for character in text:
		if ".*+?^${}()|[]\\/".contains(character):
			out += "\\" + character
		else:
			out += character
	return out


static func split_whitespace(text: String) -> PackedStringArray:
	var parts: PackedStringArray = []
	var last := 0
	for found in rx("\\s+").search_all(text):
		parts.append(text.substr(last, found.get_start() - last))
		last = found.get_end()
	parts.append(text.substr(last))
	return parts


static func literal_source(text: String) -> String:
	var pieces: PackedStringArray = []
	for part in split_whitespace(text):
		pieces.append(escape_regex(part))
	return "\\s+".join(pieces)


static func is_pattern_key(text: String) -> bool:
	return text.contains("{{") and rx(SLOT).search(text) != null


static func compile_pattern(english: String, translated: String) -> Dictionary:
	var key := english.strip_edges()
	var slots: PackedStringArray = []
	var literals: PackedStringArray = []
	var source := "^"
	var last := 0
	for found in rx(SLOT).search_all(key):
		var literal := key.substr(last, found.get_start() - last)
		literals.append(literal)
		source += literal_source(literal) + "([\\s\\S]*?)"
		slots.append(found.get_string(1))
		last = found.get_end()
	if slots.is_empty():
		return {}
	for index in range(1, literals.size()):
		if literals[index].is_empty():
			return {}
	var tail := key.substr(last)
	literals.append(tail)
	source += literal_source(tail) + "$"
	var literal_text := " ".join(literals)
	var strength := letter_count(literal_text)
	if strength == 0:
		return {}
	var anchor := ""
	for word in rx("\\p{L}+").search_all(literal_text):
		var text := word.get_string()
		if text.length() > anchor.length():
			anchor = text
	var regex := RegEx.create_from_string(source)
	if not regex.is_valid():
		return {}
	return {
		"anchor": anchor,
		"english": key,
		"literal_length": collapse(literal_text).length(),
		"regex": regex,
		"slots": slots,
		"strength": strength,
		"translated": translated,
	}


static func _fill(template: String, slots: PackedStringArray, values: PackedStringArray) -> String:
	var queues := {}
	for index in range(slots.size()):
		var queued: PackedStringArray = queues.get(slots[index], PackedStringArray())
		queued.append(values[index])
		queues[slots[index]] = queued
	var used := {}
	var out := ""
	var last := 0
	for found in rx(SLOT).search_all(template):
		out += template.substr(last, found.get_start() - last)
		var name := found.get_string(1)
		if queues.has(name):
			var queue: PackedStringArray = queues[name]
			var index: int = used.get(name, 0)
			used[name] = index + 1
			out += queue[mini(index, queue.size() - 1)]
		last = found.get_end()
	return out + template.substr(last)


static func fill_slots(template: String, params: Dictionary = {}) -> String:
	var out := ""
	var last := 0
	for found in rx(SLOT).search_all(template):
		out += template.substr(last, found.get_start() - last)
		var name := found.get_string(1)
		if params.has(name) and params[name] != null:
			out += str(params[name])
		last = found.get_end()
	return out + template.substr(last)


static func _accepts_values(pattern: Dictionary, values: PackedStringArray) -> bool:
	var strength: int = pattern["strength"]
	if strength < STRONG_LETTERS:
		var words := 0
		for value in values:
			words += word_count(value)
		if words > WEAK_MAX_VALUE_WORDS:
			return false
	if strength < SENTENCE_LETTERS:
		for value in values:
			if rx("[.!?。！？]\\s+\\S").search(value) != null:
				return false
	return true


static func is_translatable(text: String) -> bool:
	var trimmed := text.strip_edges()
	return trimmed.length() > 1 and trimmed.length() < 3000 and rx("[A-Za-z]{2}").search(trimmed) != null


static func is_numeric_date(text: String) -> bool:
	return rx("^\\d{1,2}/\\d{1,2}/\\d{4}$|^-?\\d{4,6}-\\d{2}-\\d{2}$").search(text.strip_edges()) != null


func set_entry(english: String, translated: String) -> void:
	var key := english.strip_edges()
	var value := translated.strip_edges()
	if key.is_empty() or value.is_empty():
		return
	if is_pattern_key(key):
		pattern_entries[key] = value
		_compiled = false
	else:
		exact[key] = value
		if key.contains("  ") or key.contains("\n") or key.contains("\t") or key.contains("\r"):
			var collapsed := collapse(key)
			if collapsed != key:
				exact[collapsed] = value
	_memo.clear()


func set_all(entries: Dictionary) -> void:
	for english in entries.keys():
		var translated: Variant = entries[english]
		if english is String and translated is String:
			set_entry(english, translated)


func size() -> int:
	return exact.size() + pattern_entries.size()


func pattern_count() -> int:
	return pattern_entries.size()


func get_exact(text: String) -> Variant:
	var key := text.strip_edges()
	if exact.has(key):
		return exact[key]
	if key.contains("  ") or key.contains("\n") or key.contains("\t") or key.contains("\r"):
		var collapsed := collapse(key)
		if exact.has(collapsed):
			return exact[collapsed]
	return null


func has_entry(text: String) -> bool:
	return get_exact(text) != null


func _compiled_patterns() -> Array:
	if _compiled:
		return _patterns
	_patterns = []
	var order := 0
	for english in pattern_entries.keys():
		var pattern := compile_pattern(english, pattern_entries[english])
		if pattern.is_empty():
			continue
		pattern["order"] = order
		order += 1
		_patterns.append(pattern)
	_patterns.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if int(a["strength"]) != int(b["strength"]):
			return int(a["strength"]) > int(b["strength"])
		if int(a["literal_length"]) != int(b["literal_length"]):
			return int(a["literal_length"]) > int(b["literal_length"])
		return int(a["order"]) < int(b["order"]))
	_compiled = true
	return _patterns


func _by_rule(text: String) -> Variant:
	if date_styles.is_empty():
		return null
	return localize_date(text)


func _known(inner: String) -> Variant:
	var found: Variant = get_exact(inner)
	if found != null:
		return found
	found = _by_rule(inner)
	if found != null:
		return found
	return _by_parts(inner)


func _match_pattern(text: String) -> Variant:
	for pattern in _compiled_patterns():
		var english: String = pattern["english"]
		if text.length() > english.length() + 300:
			continue
		var anchor: String = pattern["anchor"]
		if not anchor.is_empty() and not text.contains(anchor):
			continue
		var found: RegExMatch = (pattern["regex"] as RegEx).search(text)
		if found == null:
			continue
		var values: PackedStringArray = []
		for index in range(1, found.get_group_count() + 1):
			values.append(found.get_string(index))
		if not _accepts_values(pattern, values):
			continue
		if int(pattern["strength"]) < STRONG_LETTERS:
			var mixed := false
			for value in values:
				var inner := value.strip_edges()
				if rx("\\p{L}").search(inner) != null and rx("\\d").search(inner) != null and get_exact(inner) == null and _by_rule(inner) == null:
					mixed = true
					break
			if mixed:
				continue
		var translated_values: PackedStringArray = []
		for value in values:
			var inner := value.strip_edges()
			if inner.is_empty():
				translated_values.append(value)
				continue
			var known: Variant = _known(inner)
			if known == null:
				translated_values.append(value)
			else:
				var at := value.find(inner)
				translated_values.append(value.substr(0, at) + str(known) + value.substr(at + inner.length()))
		return _fill(pattern["translated"], pattern["slots"], translated_values).strip_edges()
	return null


func _by_parts(text: String) -> Variant:
	if text.length() > 240 or rx(LIST_SEPARATOR).search(text) == null:
		return null
	var parts: PackedStringArray = []
	var last := 0
	for found in rx(LIST_SEPARATOR).search_all(text):
		parts.append(text.substr(last, found.get_start() - last))
		parts.append(found.get_string())
		last = found.get_end()
	parts.append(text.substr(last))
	if parts.size() > 15:
		return null
	var changed := false
	var out := ""
	for index in range(parts.size()):
		var part := parts[index]
		var inner := part.strip_edges()
		if index % 2 == 1 or inner.is_empty():
			out += part
			continue
		var known: Variant = get_exact(inner)
		if known == null:
			known = _by_rule(inner)
		if known == null and not pattern_entries.is_empty():
			known = _match_pattern(inner)
		if known == null:
			out += part
			continue
		changed = true
		var at := part.find(inner)
		out += part.substr(0, at) + str(known) + part.substr(at + inner.length())
	return out if changed else null


func translate(text: String) -> Variant:
	var key := text.strip_edges()
	if key.is_empty():
		return null
	var known: Variant = get_exact(key)
	if known != null:
		return known
	if _memo.has(key):
		return _memo[key]
	var result: Variant = _by_rule(key)
	if result == null and not pattern_entries.is_empty():
		result = _match_pattern(key)
	if result == null:
		result = _by_parts(key)
	if _memo.size() >= MEMO_LIMIT:
		_memo.clear()
	_memo[key] = result
	return result


func format(key: String, params: Dictionary = {}) -> Variant:
	var trimmed := key.strip_edges()
	var template: Variant = pattern_entries.get(trimmed) if is_pattern_key(trimmed) else get_exact(trimmed)
	if template == null:
		return null
	return fill_slots(str(template), params)


static func _date_shapes() -> Array:
	if not _shapes.is_empty():
		return _shapes
	var long := "|".join(MONTHS)
	var short := "|".join(MONTHS_SHORT)
	_shapes = [
		{"re": RegEx.create_from_string("^(\\d{1,2}) (%s) (\\d{1,6})( BC)?$" % long), "day": 1, "month": 2, "year": 3, "bc": 4, "style": "long"},
		{"re": RegEx.create_from_string("^(%s) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{1,6})( BC)?$" % long), "month": 1, "day": 2, "year": 3, "bc": 4, "style": "long"},
		{"re": RegEx.create_from_string("^(%s) (\\d{1,2})(?:st|nd|rd|th)?, (\\d{1,6})( BC)?$" % short), "month": 1, "day": 2, "year": 3, "bc": 4, "style": "medium"},
		{"re": RegEx.create_from_string("^(\\d{1,2}) (%s) (\\d{1,6})( BC)?$" % short), "day": 1, "month": 2, "year": 3, "bc": 4, "style": "medium"},
		{"re": RegEx.create_from_string("^(%s) (\\d{1,6})( BC)?$" % long), "month": 1, "year": 2, "bc": 3, "style": "monthLong"},
		{"re": RegEx.create_from_string("^(%s) (\\d{1,6})( BC)?$" % short), "month": 1, "year": 2, "bc": 3, "style": "monthShort"},
		{"re": RegEx.create_from_string("^(\\d{1,2})/(\\d{1,2})/(\\d{4})$"), "month": 1, "day": 2, "year": 3, "numeric": true, "style": "short"},
		{"re": RegEx.create_from_string("^(-?\\d{4,6})-(\\d{2})-(\\d{2})$"), "year": 1, "month": 2, "day": 3, "numeric": true, "iso": true, "style": "medium"},
	]
	return _shapes


static func _days_in_month(astronomical: int, month_zero: int) -> int:
	if month_zero == 1:
		var leap := (posmod(astronomical, 4) == 0 and posmod(astronomical, 100) != 0) or posmod(astronomical, 400) == 0
		return 29 if leap else 28
	return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month_zero]


func localize_date(text: String) -> Variant:
	if text.length() > 40 or date_styles.is_empty():
		return null
	var value := text.strip_edges()
	for shape in _date_shapes():
		var found: RegExMatch = (shape["re"] as RegEx).search(value)
		if found == null:
			continue
		var month_zero := -1
		if shape.get("numeric", false):
			month_zero = int(found.get_string(int(shape["month"]))) - 1
		else:
			var name := found.get_string(int(shape["month"]))
			month_zero = MONTHS.find(name)
			if month_zero < 0:
				month_zero = MONTHS_SHORT.find(name)
		var signed_year := int(found.get_string(int(shape["year"])))
		var bc := false
		if shape.get("iso", false):
			bc = signed_year < 0
		elif shape.has("bc"):
			bc = not found.get_string(int(shape["bc"])).is_empty()
		var year := absi(signed_year)
		if month_zero < 0 or month_zero > 11 or year == 0:
			return null
		var astronomical := 1 - year if bc else year
		if absi(astronomical) > 270000:
			return null
		var day := int(found.get_string(int(shape["day"]))) if shape.has("day") else 1
		if day < 1 or day > _days_in_month(astronomical, month_zero):
			return null
		var templates: Variant = date_styles.get("%s|%d" % [shape["style"], 1 if bc else 0])
		if not (templates is Array) or (templates as Array).size() <= month_zero:
			return null
		var out := ""
		for part in (templates as Array)[month_zero]:
			var piece: Dictionary = part
			if piece.has("slot"):
				var number := str(day) if str(piece["slot"]) == "day" else str(year)
				var width := int(piece.get("width", 1))
				while number.length() < width:
					number = "0" + number
				out += number
			else:
				out += str(piece.get("text", ""))
		return out
	return null
