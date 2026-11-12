class_name EditorHistoryRules
extends RefCounted

const PREHISTORY_VERSION := 1
const UPDATE_FAMILIES := ["warUpdates", "relationUpdates", "agreementUpdates", "puppetUpdates", "storylineUpdates", "canonicalUpdates"]
const IMPORTANCE := ["minor", "major"]
const KINDS := ["world", "diplomacy", "military", "economic", "domestic"]
const EVENT_TAGS := ["Military", "Diplomacy", "Economy", "Politics", "Culture", "Disaster"]
const MAX_EVENT_TAGS := 3
const MAX_EVENTS := 60
const MAX_UPDATES_PER_FAMILY := 64
const LIMITS := {"id": 80, "date": 24, "title": 200, "description": 4000, "kind": 40, "prompt": 2000, "summary": 2000, "quote": 600, "speaker": 120}
const DIGITS := "0123456789abcdefghijklmnopqrstuvwxyz"

static var _counter := 0


static func clean(value: Variant, most := 400) -> String:
	return EditorWarRules.js_string(value).replace("\r\n", "\n").strip_edges().substr(0, most)


static func base36(number: int) -> String:
	if number == 0:
		return "0"
	var value := absi(number)
	var out := ""
	while value > 0:
		out = DIGITS[value % 36] + out
		value = value / 36
	return ("-" if number < 0 else "") + out


static func new_event_id() -> String:
	_counter += 1
	var now := int(Time.get_unix_time_from_system() * 1000.0)
	return "prehistory-%s-%s" % [base36(now), base36(_counter)]


static func normalize_tags(value: Variant) -> Array:
	var tags: Array = []
	if not (value is Array):
		return tags
	for entry in value:
		if not (entry is String):
			continue
		var wanted: String = (entry as String).strip_edges().to_lower()
		var found := ""
		for candidate in EVENT_TAGS:
			if str(candidate).to_lower() == wanted:
				found = str(candidate)
				break
		if found.is_empty() or tags.has(found):
			continue
		tags.append(found)
		if tags.size() >= MAX_EVENT_TAGS:
			break
	return tags


static func normalize_event(raw: Variant, draft := false) -> Variant:
	if not (raw is Dictionary):
		return null
	var source: Dictionary = raw
	var title := clean(source.get("title"), LIMITS["title"])
	if title.is_empty() and not draft:
		return null
	var importance := clean(source.get("importance")).to_lower()
	var quote: Variant = source.get("quote")
	var quote_text := clean((quote as Dictionary).get("text") if quote is Dictionary else null, LIMITS["quote"])
	var speaker := clean((quote as Dictionary).get("speaker") if quote is Dictionary else null, LIMITS["speaker"])
	var role := clean((quote as Dictionary).get("role") if quote is Dictionary else null, LIMITS["speaker"])
	var id := clean(source.get("id"), LIMITS["id"])
	var kind := clean(source.get("kind"), LIMITS["kind"]).to_lower()
	var event := {
		"id": id if not id.is_empty() else new_event_id(),
		"date": clean(source.get("date"), LIMITS["date"]),
		"title": title,
		"description": clean(source.get("description"), LIMITS["description"]),
		"importance": importance if IMPORTANCE.has(importance) else "minor",
		"kind": kind if not kind.is_empty() else "world",
		"tags": normalize_tags(source.get("tags")),
	}
	var war_id := clean(source.get("warId"), LIMITS["id"])
	if not war_id.is_empty():
		event["warId"] = war_id
	var ref := clean(source.get("ref"), LIMITS["id"])
	if not ref.is_empty():
		event["ref"] = ref
	if source.get("notable") == true:
		event["notable"] = true
	if not quote_text.is_empty():
		var kept := {"text": quote_text}
		if not speaker.is_empty():
			kept["speaker"] = speaker
		if not role.is_empty():
			kept["role"] = role
		event["quote"] = kept
	return event


static func normalize_record(value: Variant, draft := false) -> Variant:
	if not (value is Dictionary):
		return null
	var source: Dictionary = value
	var seen := {}
	var events: Array = []
	var given: Variant = source.get("events")
	if given is Array:
		for raw in given:
			var event: Variant = normalize_event(raw, draft)
			if event == null:
				continue
			if seen.has(event["id"]):
				event["id"] = new_event_id()
			seen[event["id"]] = true
			events.append(event)
			if events.size() >= MAX_EVENTS:
				break
	var updates := {}
	var given_updates: Variant = source.get("updates")
	for family in UPDATE_FAMILIES:
		var kept: Array = []
		var rows: Variant = (given_updates as Dictionary).get(family) if given_updates is Dictionary else null
		if rows is Array:
			for row in rows:
				if row is Dictionary:
					kept.append((row as Dictionary).duplicate(true))
				if kept.size() >= MAX_UPDATES_PER_FAMILY:
					break
		updates[family] = kept
	var record := {
		"version": PREHISTORY_VERSION,
		"prompt": clean(source.get("prompt"), LIMITS["prompt"]),
		"summary": clean(source.get("summary"), LIMITS["summary"]),
	}
	var generated_at := clean(source.get("generatedAt"), 40)
	if not generated_at.is_empty():
		record["generatedAt"] = generated_at
	record["events"] = events
	record["updates"] = updates
	return record


static func empty_record() -> Dictionary:
	return normalize_record({}) as Dictionary


static func same_record(a: Variant, b: Variant) -> bool:
	return EditorWarRules.same_json(normalize_record(a, true), normalize_record(b, true))


static func problems(record: Variant, start_date: String) -> Array:
	var start := start_date if not EditorWarRules.parse_game_date(start_date).is_empty() else ""
	var out: Array = []
	var events: Variant = (record as Dictionary).get("events") if record is Dictionary else null
	if not (events is Array):
		return out
	for event in events:
		var entry: Dictionary = event if event is Dictionary else {}
		var id: Variant = entry.get("id")
		if clean(entry.get("title")).is_empty():
			out.append({"id": id, "problem": "title"})
		if EditorWarRules.parse_game_date(entry.get("date")).is_empty():
			out.append({"id": id, "problem": "date"})
		elif not start.is_empty() and EditorWarRules.compare_game_dates(entry.get("date"), start) >= 0:
			out.append({"id": id, "problem": "late"})
	return out


static func _names(value: Variant) -> Array:
	var out: Array = []
	if not (value is Array):
		return out
	for name in value:
		var text := clean(name, 120)
		if not text.is_empty():
			out.append(text)
	return out


static func _score(source: Dictionary, key: String) -> String:
	if not source.has(key):
		return ""
	var number := EditorWarRules.to_number(source[key])
	if not EditorWarRules.is_finite_number(number):
		return ""
	return EditorWarRules.js_number(floorf(number + 0.5))


static func _semantic_row(fact: Dictionary) -> Dictionary:
	var kind := clean(fact.get("kind"), 40).to_lower()
	if kind == "war":
		return {"kind": kind, "title": clean(fact.get("title"), 160), "sideA": _names(fact.get("sideA")), "sideB": _names(fact.get("sideB")), "detail": clean(fact.get("status"), 40)}
	if kind == "relation":
		return {"kind": kind, "sideA": _names([fact.get("a")]), "sideB": _names([fact.get("b")]), "detail": _score(fact, "score")}
	if kind == "agreement":
		var parties: Array = (fact.get("parties") as Array).duplicate() if fact.get("parties") is Array else []
		for key in ["guarantor", "beneficiary", "grantor", "grantee"]:
			parties.append(fact.get(key))
		return {"kind": kind, "title": clean(fact.get("title"), 160), "sideA": _names(parties), "detail": clean(fact.get("type"), 60)}
	if kind == "puppet":
		return {"kind": kind, "sideA": _names([fact.get("overlord")]), "sideB": _names([fact.get("puppet")]), "detail": clean(fact.get("puppetKind"), 60)}
	return {"kind": "storyline", "title": clean(fact.get("title"), 160), "sideA": _names(fact.get("participants")), "detail": clean(fact.get("status"), 40)}


static func update_rows(record: Variant) -> Array:
	var rows: Array = []
	var updates: Variant = (record as Dictionary).get("updates") if record is Dictionary else null
	for family in UPDATE_FAMILIES:
		var entries: Variant = (updates as Dictionary).get(family) if updates is Dictionary else null
		if not (entries is Array):
			continue
		for index in range((entries as Array).size()):
			var update: Variant = (entries as Array)[index]
			if not (update is Dictionary):
				continue
			var source: Dictionary = update
			var row := {"family": family, "index": index, "title": "", "sideA": [], "sideB": [], "detail": "", "kind": ""}
			var first := clean(source.get("title"), 160)
			match family:
				"warUpdates":
					row["title"] = clean(source.get("id"), 120)
					row["sideA"] = _names(source.get("actors"))
					row["sideB"] = _names(source.get("opponents"))
					row["detail"] = clean(source.get("op"), 40)
				"relationUpdates":
					row["sideA"] = _names([source.get("a")])
					row["sideB"] = _names([source.get("b")])
					row["detail"] = _score(source, "score")
				"agreementUpdates":
					row["title"] = first if not first.is_empty() else clean(source.get("id"), 160)
					row["sideA"] = _names(source.get("parties"))
					row["detail"] = clean(source.get("type"), 60)
				"puppetUpdates":
					row["sideA"] = _names([source.get("overlord")])
					row["sideB"] = _names([source.get("puppet")])
					row["detail"] = clean(source.get("kind"), 60)
				"canonicalUpdates":
					var semantic := _semantic_row(source)
					for key in semantic:
						row[key] = semantic[key]
				_:
					row["title"] = first if not first.is_empty() else clean(source.get("id"), 160)
					row["sideA"] = _names(source.get("participants"))
					row["detail"] = clean(source.get("status"), 40)
			rows.append(row)
	return rows


static func row_line(row: Dictionary) -> String:
	var side_a := ", ".join(PackedStringArray(row.get("sideA", [])))
	var side_b := ", ".join(PackedStringArray(row.get("sideB", [])))
	var family := str(row.get("family", ""))
	var shape := family
	if family == "canonicalUpdates":
		shape = str({"war": "warUpdates", "relation": "relationUpdates", "agreement": "agreementUpdates", "puppet": "puppetUpdates"}.get(str(row.get("kind", "")), "storylineUpdates"))
	match shape:
		"warUpdates":
			return "War: %s against %s" % [side_a, side_b]
		"relationUpdates":
			return "Relations between %s and %s: %s" % [side_a, side_b, str(row.get("detail", ""))]
		"agreementUpdates":
			return "Agreement: %s (%s)" % [str(row.get("title", "")), side_a]
		"puppetUpdates":
			return "Subordination: %s over %s" % [side_a, side_b]
	return "Ongoing storyline: %s" % str(row.get("title", ""))


static func without_update(record: Variant, family: String, index: int) -> Variant:
	var next: Variant = normalize_record(record, true)
	if next == null or not UPDATE_FAMILIES.has(family):
		return next
	var kept: Array = []
	var rows: Array = next["updates"][family]
	for at in range(rows.size()):
		if at != index:
			kept.append(rows[at])
	next["updates"][family] = kept
	return next
