class_name EditorInstitutionAuthoring
extends VBoxContainer

signal details_changed(details: Dictionary)
signal value_changed(value: Variant)

const LOGO_TYPES := {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}

static var _origin := ""
static var _logo_cache := {}

var _engine: EngineLink
var _props: Dictionary = {}
var _scenario_id := ""
var _state: Dictionary = {}
var _rows: Array = []
var _card_box: VBoxContainer
var _manager: PoliticalManager
var _query := ""
var _selected_id := ""
var _draft: Dictionary = {}
var _dirty := false
var _busy := false
var _message := ""
var _pending_logo := ""
var _lookup := {}
var _delete_button: Button
var _discard_button: Button
var _save_button: Button
var _message_holder: VBoxContainer
var _header_holder: VBoxContainer
var _members_section: Dictionary = {}
var _picker: InstitutionPolityPicker
var _chips_holder: VBoxContainer
var _bulk_edit: TextEdit
var _unmatched_holder: VBoxContainer
var _preview_large: PanelContainer
var _badge_select: OptionButton
var _logo_url_input: LineEdit
var _syncing := false
var _listed_new := false


func _init() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 0)


func setup(engine: EngineLink, props: Dictionary) -> void:
	_engine = engine
	_props = props
	var details: Dictionary = props.get("details", {})
	_scenario_id = str((details.get("scenario", {}) as Dictionary).get("id", ""))
	_build_card()
	if _origin.is_empty():
		var hello := await _engine.request("hello")
		if hello.get("ok", false):
			_origin = str((hello["result"] as Dictionary).get("origin", ""))
	await _reload(true)


func update_props(props: Dictionary) -> void:
	_props = props
	if _scenario_id.is_empty() or _state.is_empty():
		return
	await _reload(not _dirty)


func _host() -> Node:
	var host: Variant = _props.get("host")
	if host is Node and is_instance_valid(host):
		return host
	return self


func _reload(reset_draft: bool) -> void:
	var reply := await _engine.request("editor.politics.inst.load", {"scenarioId": _scenario_id})
	if not reply.get("ok", false) or not is_inside_tree():
		return
	_take_state(reply["result"])
	if reset_draft:
		_reset_to_selection()
	_render_card()
	if _manager:
		_render_list()
		if reset_draft:
			_render_main()


func _take_state(state: Dictionary) -> void:
	_state = state
	_rows = state.get("rows", [])
	_lookup.clear()
	for entry in (state.get("polityOptions", []) as Array):
		var option: Dictionary = entry
		for alias in (option.get("aliases", []) as Array):
			_lookup[str(alias).to_lower()] = option


func _row_by_id(id: String) -> Dictionary:
	for entry in _rows:
		var row: Dictionary = entry
		if str(row.get("id", "")) == id:
			return row
	return {}


func _reset_to_selection() -> void:
	var selected := _row_by_id(_selected_id)
	if selected.is_empty() and not _rows.is_empty():
		selected = _rows[0]
	_selected_id = str(selected.get("id", ""))
	_draft = ((selected.get("draft", _state.get("emptyDraft", {})) if not selected.is_empty() else _state.get("emptyDraft", {})) as Dictionary).duplicate(true)
	_pending_logo = ""


func _build_card() -> void:
	EditorKit.clear(self)
	var parts := PoliticalKit.box(Color(1, 1, 1, 0.03), Color(1, 1, 1, 0.08), 18, Vector4(14, 14, 14, 14), 0)
	add_child(parts[0])
	add_child(PoliticalKit.gap(14))
	_card_box = parts[1]


func _total_members() -> int:
	return int(_state.get("totalMembers", 0))


func _render_card() -> void:
	EditorKit.clear(_card_box)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 11)
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	texts.add_child(UI.label("Institutions", 15, Color(1, 1, 1, 0.94), 800))
	texts.add_child(PoliticalKit.text("Create institutions that already exist when the scenario begins. Political World generation may enrich membership and governance later, but it will preserve the identity and artwork you author here.", 11, Color(1, 1, 1, 0.5)))
	texts.add_child(PoliticalKit.gap(2))
	var count := _rows.size()
	var members := _total_members()
	texts.add_child(UI.label("%d institution%s configured · %d starting member%s." % [count, "" if count == 1 else "s", members, "" if members == 1 else "s"], 10, Color(1, 1, 1, 0.38)))
	row.add_child(texts)
	var manage := PoliticalKit.action_button("Manage institutions", "raised")
	manage.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	manage.pressed.connect(_open_manager)
	row.add_child(manage)
	_card_box.add_child(row)
	if _rows.is_empty():
		_card_box.add_child(PoliticalKit.gap(12))
		var parts := PoliticalKit.box(Color(1, 1, 1, 0.035), PoliticalKit.GREY_BORDER, 12, Vector4(11, 10, 11, 10), 0)
		(parts[1] as VBoxContainer).add_child(UI.rich("**No institutions created yet.** Open the manager to author one manually, or leave this empty and let Political World generation establish relevant institutions later.", 11, PoliticalKit.GREY_MUTED))
		_card_box.add_child(parts[0])


func _subtitle() -> String:
	var count := _rows.size()
	var members := _total_members()
	return "%d institution%s · %d starting membership record%s" % [count, "" if count == 1 else "s", members, "" if members == 1 else "s"]


func _open_manager() -> void:
	if _manager:
		return
	_manager = PoliticalManager.new("Scenario authoring", "Institutions", _subtitle(), 1312.0, 704.0, 0.26, 256.0, "Close Institutions manager")
	_host().add_child(_manager)
	_manager.close_requested.connect(_close_manager)
	_manager.escape_pressed.connect(_close_manager)
	var search := PoliticalKit.input(_query, "Search institutions...", func(value: String) -> void:
		_query = value
		_render_list())
	search.tooltip_text = "Search institutions"
	_manager.aside_top.add_child(search)
	var create := PoliticalKit.action_button("+ Create institution", "raised")
	create.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	create.pressed.connect(_create_new)
	_manager.aside_top.add_child(create)
	_render_list()
	_render_main()


func _close_manager() -> void:
	if _dirty and not await EditorKit.ask(_host(), "Discard unsaved institution edits?"):
		return
	if _dirty:
		_discard()
	if _manager:
		_manager.queue_free()
		_manager = null
	_message = ""


func _selected_is_new() -> bool:
	return str(_draft.get("id", "")).is_empty() and _dirty


func _render_list() -> void:
	if not _manager:
		return
	_manager.subtitle_label.text = _subtitle()
	EditorKit.clear(_manager.aside_list)
	_listed_new = _selected_is_new()
	if _selected_is_new():
		var badge := PoliticalKit.badge("NEW", Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.24), PoliticalKit.AMBER_SOFT)
		_manager.aside_list.add_child(_manager.list_row("New institution", "Unsaved draft", true, badge, func() -> void: pass))
	var needle := PoliticalKit.clean(_query).to_lower()
	var shown := 0
	for entry in _rows:
		var row: Dictionary = entry
		var haystack := ("%s %s %s %s" % [str(row.get("name", "")), str(row.get("shortName", "")), str(row.get("kind", "")), str(row.get("id", ""))]).to_lower()
		if not needle.is_empty() and not haystack.contains(needle):
			continue
		shown += 1
		var id := str(row.get("id", ""))
		var short_name := str(row.get("shortName", ""))
		var count_label := UI.label(str(int(row.get("memberCount", 0))), 9, Color(1, 1, 1, 0.38), 800)
		_manager.aside_list.add_child(_manager.list_row(short_name if not short_name.is_empty() else str(row.get("name", "")), str(row.get("name", "")), id == _selected_id and not _selected_is_new(), count_label, func() -> void: _choose(row)))
	if shown == 0:
		var empty := UI.label("No institutions match this search." if not _rows.is_empty() else "No authored institutions yet.", 12, Color(1, 1, 1, 0.4))
		empty.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var holder := MarginContainer.new()
		holder.add_theme_constant_override("margin_top", 16)
		holder.add_theme_constant_override("margin_bottom", 16)
		holder.add_child(empty)
		_manager.aside_list.add_child(holder)


func _choose(row: Dictionary) -> void:
	if str(row.get("id", "")) == _selected_id and not str(_draft.get("id", "")).is_empty():
		return
	if _dirty and not await EditorKit.ask(_host(), "Discard unsaved institution edits?"):
		return
	_selected_id = str(row.get("id", ""))
	_draft = (row.get("draft", {}) as Dictionary).duplicate(true)
	_pending_logo = ""
	_dirty = false
	_message = ""
	_render_list()
	_render_main()


func _create_new() -> void:
	if _dirty and not await EditorKit.ask(_host(), "Discard unsaved institution edits?"):
		return
	_selected_id = ""
	_draft = (_state.get("emptyDraft", {}) as Dictionary).duplicate(true)
	_pending_logo = ""
	_dirty = true
	_message = ""
	_render_list()
	_render_main()


func _discard() -> void:
	var selected := _row_by_id(_selected_id)
	_draft = ((selected.get("draft", {}) if not selected.is_empty() else _state.get("emptyDraft", {})) as Dictionary).duplicate(true)
	_pending_logo = ""
	_dirty = false
	_message = ""
	if _manager:
		_render_list()
		_render_main()


func _edit(field: String, value: Variant) -> void:
	_dirty = true
	_message = ""
	_draft[field] = value
	_after_edit()


func _after_edit() -> void:
	_update_header()
	_render_header_identity()
	if _manager and _selected_is_new() != _listed_new:
		_render_list()


func _render_main() -> void:
	if not _manager:
		return
	var scroll_at := _manager.main_scroll.scroll_vertical
	_manager.clear_main()
	_header_holder = VBoxContainer.new()
	_manager.main_header.add_child(_header_holder)
	_render_header_identity()
	_message_holder = VBoxContainer.new()
	_manager.main_body.add_child(_message_holder)
	_update_message()
	_render_sections()
	_update_header()
	_restore_scroll(scroll_at)


func _restore_scroll(value: int) -> void:
	await get_tree().process_frame
	if _manager:
		_manager.main_scroll.scroll_vertical = value


func _preview_url() -> String:
	var stored := ""
	if bool(_draft.get("logoAsset", false)) and not str(_draft.get("id", "")).is_empty() and not _scenario_id.is_empty():
		stored = "/api/scenarios/%s/institution-logo/%s" % [_scenario_id.uri_encode(), str(_draft.get("id", "")).uri_encode()]
	return _pending_logo if not _pending_logo.is_empty() else stored


func _logo_url() -> String:
	var preview := _preview_url()
	if not preview.is_empty():
		return preview
	var explicit := EditorInstitutionAuthoring.normalize_logo_url(str(_draft.get("logoUrl", "")))
	if not explicit.is_empty():
		return explicit
	if bool(_draft.get("logoAsset", false)) and not str(_draft.get("id", "")).strip_edges().is_empty():
		return "/api/runtime/institution-logo/%s" % str(_draft.get("id", "")).strip_edges().uri_encode()
	var slug := EditorInstitutionAuthoring.slug(str(_draft.get("badgeKey", "")))
	if slug.is_empty():
		return ""
	for pair in (_state.get("badges", []) as Array):
		if str((pair as Array)[0]) == slug:
			return str((pair as Array)[1])
	return ""


static func slug(value: String) -> String:
	var text := value.strip_edges().to_lower()
	var marks := RegEx.create_from_string("[\\x{0300}-\\x{036f}]")
	text = marks.sub(text, "", true)
	var others := RegEx.create_from_string("[^a-z0-9]+")
	text = others.sub(text, "-", true)
	var edges := RegEx.create_from_string("^-+|-+$")
	text = edges.sub(text, "", true)
	return text.substr(0, 72)


static func normalize_logo_url(value: String) -> String:
	var url := value.strip_edges()
	if url.is_empty() or url.length() > 2400:
		return ""
	var allowed := false
	if RegEx.create_from_string("(?i)^data:image\\/(?:png|jpe?g|webp|gif);").search(url):
		allowed = true
	elif RegEx.create_from_string("(?i)^https?:\\/\\/").search(url):
		allowed = true
	elif RegEx.create_from_string("^(?:\\/|\\.\\.?\\/)").search(url):
		allowed = true
	elif RegEx.create_from_string("(?i)^[a-z0-9][a-z0-9_./%+@() -]*\\.(?:svg|png|jpe?g|webp|gif)(?:[?#].*)?$").search(url):
		allowed = true
	return url.substr(0, 2400) if allowed else ""


func _initials() -> String:
	var source := ""
	for field in ["shortName", "name", "id"]:
		if PoliticalKit.js_truthy(_draft.get(field, "")):
			source = str(_draft.get(field, ""))
			break
	if source.is_empty():
		source = "ORG"
	var words := source.strip_edges().split(" ", false)
	var out := ""
	for index in range(mini(3, words.size())):
		out += words[index].substr(0, 1)
	out = out.to_upper().substr(0, 4)
	return out if not out.is_empty() else "ORG"


func _logo_preview(size: float) -> PanelContainer:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(7 / 255.0, 10 / 255.0, 18 / 255.0, 0.72), Color(1, 1, 1, 0.1), 14, 1, Vector4(0, 0, 0, 0)))
	holder.custom_minimum_size = Vector2(size, size)
	holder.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	holder.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	holder.clip_contents = true
	var initials := UI.label(_initials(), 12, Color(1, 1, 1, 0.82), 900, "Arial", 1)
	initials.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	initials.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	holder.add_child(initials)
	var image := TextureRect.new()
	image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image.custom_minimum_size = Vector2(size - 11.0, size - 11.0)
	image.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	image.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	image.visible = false
	holder.add_child(image)
	var url := _logo_url()
	if not url.is_empty():
		_load_logo(url, func(texture: Texture2D) -> void:
			if not is_instance_valid(image):
				return
			image.texture = texture
			image.visible = texture != null
			initials.visible = texture == null)
	return holder


func _load_logo(url: String, done: Callable) -> void:
	if url.begins_with("data:"):
		done.call(PoliticalKit.data_url_texture(url))
		return
	if _logo_cache.has(url):
		done.call(_logo_cache[url])
		return
	var absolute := url
	if not url.begins_with("http://") and not url.begins_with("https://"):
		if _origin.is_empty():
			done.call(null)
			return
		absolute = _origin + (url if url.begins_with("/") else "/" + url.trim_prefix("./"))
	var request := HTTPRequest.new()
	add_child(request)
	request.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
		request.queue_free()
		var texture: Texture2D = null
		if result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300:
			texture = PoliticalKit.decode_image(body, url)
		_logo_cache[url] = texture
		done.call(texture))
	if request.request(absolute) != OK:
		request.queue_free()
		done.call(null)


func _render_header_identity() -> void:
	if not is_instance_valid(_header_holder):
		return
	EditorKit.clear(_header_holder)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var identity := HBoxContainer.new()
	identity.add_theme_constant_override("separation", 11)
	identity.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	identity.add_child(_logo_preview(54.0))
	var texts := VBoxContainer.new()
	texts.add_theme_constant_override("separation", 3)
	texts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var is_new := _selected_is_new()
	var title_row := EditorKit.flow(7)
	var name := PoliticalKit.clean(_draft.get("name", ""))
	title_row.add_child(UI.label(name if not name.is_empty() else "New institution", 17, UI.WHITE, 850))
	title_row.add_child(PoliticalKit.badge("NEW DRAFT" if is_new else "SCENARIO CANON", Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.12) if is_new else Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.12), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.24) if is_new else Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.24), PoliticalKit.AMBER_SOFT if is_new else PoliticalKit.GREEN_SOFT))
	texts.add_child(title_row)
	var short_name := PoliticalKit.clean(_draft.get("shortName", ""))
	var subtitle := short_name if not short_name.is_empty() else ("Unsaved institution" if is_new else "Choose an institution to edit")
	var id := str(_draft.get("id", ""))
	texts.add_child(UI.label(subtitle + (" · " + id if not id.is_empty() else ""), 10, Color(1, 1, 1, 0.4)))
	var note := PoliticalKit.text("Create institutions that already exist when the scenario begins. Political World may enrich them later while preserving the authored canonical identity, membership and visual assets.", 11, Color(1, 1, 1, 0.44))
	note.custom_minimum_size.x = 320
	texts.add_child(note)
	identity.add_child(texts)
	row.add_child(identity)
	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 6)
	buttons.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_delete_button = null
	if not _row_by_id(_selected_id).is_empty():
		_delete_button = PoliticalKit.action_button("Delete institution", "danger")
		_delete_button.pressed.connect(_delete)
		buttons.add_child(_delete_button)
	_discard_button = PoliticalKit.action_button("Discard", "plain")
	_discard_button.pressed.connect(_discard)
	buttons.add_child(_discard_button)
	_save_button = PoliticalKit.action_button("Save institution", "raised")
	_save_button.pressed.connect(_save)
	buttons.add_child(_save_button)
	row.add_child(buttons)
	_header_holder.add_child(row)
	_update_header()


func _update_header() -> void:
	if not is_instance_valid(_save_button):
		return
	if is_instance_valid(_delete_button):
		PoliticalKit.set_enabled(_delete_button, not _busy, 0.55)
	PoliticalKit.set_enabled(_discard_button, _dirty and not _busy, 0.45)
	PoliticalKit.set_enabled(_save_button, _dirty and not _busy, 0.5)
	_save_button.text = "Saving..." if _busy else "Save institution"
	_update_message()


func _update_message() -> void:
	if not is_instance_valid(_message_holder):
		return
	EditorKit.clear(_message_holder)
	if _message.is_empty():
		return
	var success := RegEx.create_from_string("(?i)saved|deleted from").search(_message) != null
	_message_holder.add_child(PoliticalKit.tone_box(_message, Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.08) if success else Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.08), Color(34 / 255.0, 197 / 255.0, 94 / 255.0, 0.2) if success else Color(248 / 255.0, 113 / 255.0, 113 / 255.0, 0.22), PoliticalKit.GREEN_INK if success else PoliticalKit.RED_INK, 11, 10, Vector4(10, 9, 10, 9)))


func _render_sections() -> void:
	var identity := PoliticalKit.section("Identity & lifecycle", true)
	_manager.main_body.add_child(identity["panel"])
	var identity_content: VBoxContainer = identity["content"]
	identity_content.add_child(PoliticalKit.gap(3))
	identity_content.add_child(PoliticalKit.field("Name", PoliticalKit.input(str(_draft.get("name", "")), "e.g. Northern League", func(value: String) -> void: _edit("name", value))))
	var grid := PoliticalKit.AutoGrid.new(208.0, 10.0)
	grid.add_child(PoliticalKit.field("Short name", PoliticalKit.input(str(_draft.get("shortName", "")), "NL", func(value: String) -> void: _edit("shortName", value))))
	grid.add_child(PoliticalKit.field("Type", PoliticalKit.select(_state.get("kinds", []), str(_draft.get("kind", "other")), func(value: String) -> void: _edit("kind", value))))
	grid.add_child(PoliticalKit.field("Founded", PoliticalKit.input(str(_draft.get("foundedDate", "")), "YYYY-MM-DD", func(value: String) -> void: _edit("foundedDate", value))))
	grid.add_child(PoliticalKit.field("Dissolved", PoliticalKit.input(str(_draft.get("dissolvedDate", "")), "Leave blank if active", func(value: String) -> void: _edit("dissolvedDate", value))))
	identity_content.add_child(grid)

	_members_section = PoliticalKit.section(_members_title(), true)
	_manager.main_body.add_child(_members_section["panel"])
	var members: VBoxContainer = _members_section["content"]
	members.add_child(PoliticalKit.text("Add the polities that belong to this institution when the scenario begins. Existing member roles and statuses are preserved for members that remain in the list.", 10, Color(1, 1, 1, 0.44)))
	_picker = InstitutionPolityPicker.new()
	_picker.setup("Type a polity name", true)
	_picker.chosen.connect(_add_member)
	members.add_child(_picker)
	_chips_holder = VBoxContainer.new()
	members.add_child(_chips_holder)
	var bulk := PoliticalKit.section("Advanced bulk edit member list", false, Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, Vector4(0, 0, 0, 0), 10, 750, Color(1, 1, 1, 0.5))
	var on_bulk := func(value: String) -> void:
		if _syncing:
			return
		_edit("membersText", value)
		_render_members(false)
	_bulk_edit = PoliticalKit.area(str(_draft.get("membersText", "")), 96, on_bulk, "One polity name per line")
	(bulk["content"] as VBoxContainer).add_child(_bulk_edit)
	members.add_child(bulk["panel"])
	_unmatched_holder = VBoxContainer.new()
	members.add_child(_unmatched_holder)
	_render_members(false)

	var visual := PoliticalKit.section("Visual identity", false)
	_manager.main_body.add_child(visual["panel"])
	var visual_content: VBoxContainer = visual["content"]
	var visual_row := HBoxContainer.new()
	visual_row.add_theme_constant_override("separation", 13)
	_preview_large = _logo_preview(80.0)
	visual_row.add_child(_preview_large)
	var visual_fields := VBoxContainer.new()
	visual_fields.add_theme_constant_override("separation", 9)
	visual_fields.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var badges: Array = [["", "None / custom logo"]]
	for pair in (_state.get("badges", []) as Array):
		badges.append([str((pair as Array)[0]), str((pair as Array)[0]).to_upper()])
	var badge_value := "" if (PoliticalKit.js_truthy(_draft.get("logoUrl", "")) or bool(_draft.get("logoAsset", false))) else str(_draft.get("badgeKey", ""))
	_badge_select = PoliticalKit.select(badges, badge_value, func(value: String) -> void:
		_pending_logo = ""
		_dirty = true
		_draft["badgeKey"] = value
		_draft["logoUrl"] = ""
		_draft["logoAsset"] = false
		_refresh_visual())
	visual_fields.add_child(PoliticalKit.field("Historical emblem", _badge_select))
	_logo_url_input = PoliticalKit.input(str(_draft.get("logoUrl", "")), "logos/my-alliance.svg or https://...", func(value: String) -> void:
		if _syncing:
			return
		_pending_logo = ""
		_dirty = true
		_message = ""
		_draft["badgeKey"] = ""
		_draft["logoUrl"] = value
		_draft["logoAsset"] = false
		_refresh_visual(false))
	visual_fields.add_child(PoliticalKit.field("Custom logo URL or asset path", _logo_url_input))
	var logo_buttons := HBoxContainer.new()
	logo_buttons.add_theme_constant_override("separation", 6)
	var upload := PoliticalKit.action_button("Upload small logo", "plain")
	upload.pressed.connect(_upload_logo)
	logo_buttons.add_child(upload)
	var clear := PoliticalKit.action_button("Clear logo", "plain")
	clear.pressed.connect(func() -> void:
		_pending_logo = ""
		_dirty = true
		_draft["badgeKey"] = ""
		_draft["logoUrl"] = ""
		_draft["logoAsset"] = false
		_refresh_visual())
	logo_buttons.add_child(clear)
	visual_fields.add_child(logo_buttons)
	visual_fields.add_child(PoliticalKit.text("PNG, JPEG, WebP and GIF uploads up to 256 KB can travel with the scenario. Use an asset path or URL for SVG or larger artwork.", 10, Color(1, 1, 1, 0.38)))
	visual_row.add_child(visual_fields)
	visual_content.add_child(PoliticalKit.gap(3))
	visual_content.add_child(visual_row)

	var advanced := PoliticalKit.section("Advanced details", false)
	_manager.main_body.add_child(advanced["panel"])
	var advanced_content: VBoxContainer = advanced["content"]
	advanced_content.add_child(PoliticalKit.field("Aliases", PoliticalKit.input(str(_draft.get("aliasesText", "")), "Comma-separated alternate names", func(value: String) -> void: _edit("aliasesText", value))))
	advanced_content.add_child(PoliticalKit.field("Author note", PoliticalKit.area(str(_draft.get("note", "")), 80, func(value: String) -> void: _edit("note", value), "Optional note for scenario authors")))
	var id := str(_draft.get("id", ""))
	if not id.is_empty():
		var id_row := HBoxContainer.new()
		id_row.add_theme_constant_override("separation", 4)
		id_row.add_child(UI.label("Canonical id:", 10, Color(1, 1, 1, 0.34)))
		var code := UI.label(id, 10, Color(1, 1, 1, 0.34))
		code.add_theme_font_override("font", UI.font(400, "Consolas"))
		id_row.add_child(code)
		advanced_content.add_child(id_row)


func _refresh_visual(sync_inputs := true) -> void:
	_update_header()
	_render_header_identity()
	if is_instance_valid(_preview_large):
		var parent := _preview_large.get_parent()
		var at := _preview_large.get_index()
		var fresh := _logo_preview(80.0)
		parent.add_child(fresh)
		parent.move_child(fresh, at)
		_preview_large.queue_free()
		_preview_large = fresh
	if not sync_inputs:
		return
	_syncing = true
	if is_instance_valid(_logo_url_input) and _logo_url_input.text != str(_draft.get("logoUrl", "")):
		_logo_url_input.text = str(_draft.get("logoUrl", ""))
	if is_instance_valid(_badge_select):
		var badge_value := "" if (PoliticalKit.js_truthy(_draft.get("logoUrl", "")) or bool(_draft.get("logoAsset", false))) else str(_draft.get("badgeKey", ""))
		for index in range(_badge_select.item_count):
			if str(_badge_select.get_item_metadata(index)) == badge_value:
				_badge_select.select(index)
	_syncing = false


func _members_title() -> String:
	return "Starting membership (%d)" % _member_names().size()


func _member_names() -> Array:
	var out: Array = []
	var seen := {}
	for raw in str(_draft.get("membersText", "")).split("\n"):
		var name := str(raw).trim_suffix("\r").strip_edges()
		var key := name.to_lower()
		if name.is_empty() or seen.has(key):
			continue
		seen[key] = true
		out.append(name)
	return out


func _set_member_names(names: Array) -> void:
	var lines: PackedStringArray = []
	for name in names:
		lines.append(str(name))
	_edit("membersText", "\n".join(lines))
	_render_members(true)


func _add_member(name: String) -> void:
	var next := name.strip_edges()
	if next.is_empty():
		return
	var names := _member_names()
	for existing in names:
		if str(existing).to_lower() == next.to_lower():
			return
	names.append(next)
	_set_member_names(names)


func _remove_member(name: String) -> void:
	var names := _member_names().filter(func(entry: Variant) -> bool: return str(entry).to_lower() != name.to_lower())
	_set_member_names(names)


func _resolve_polity(value: String) -> String:
	var token := PoliticalKit.clean(value)
	if token.is_empty() or RegEx.create_from_string("(?i)^(NA|XCA|Z0[1-9])$").search(token):
		return ""
	var aliases: Dictionary = _state.get("resolverAliases", {})
	return str(aliases.get(token.to_lower(), token))


func _unmatched(names: Array) -> Array:
	if not bool(_state.get("checkUnmatched", false)):
		return []
	var known := {}
	for entry in (_state.get("known", []) as Array):
		known[str(entry)] = true
	var out: Array = []
	for entry in names:
		var name := str(entry).strip_edges()
		if name.is_empty():
			continue
		if not known.has(name) and not known.has(_resolve_polity(name)):
			out.append(str(entry))
	return out


func _render_members(sync_bulk: bool) -> void:
	if not is_instance_valid(_chips_holder):
		return
	var names := _member_names()
	PoliticalKit.set_section_title(_members_section, _members_title())
	var taken := {}
	for name in names:
		taken[str(name).to_lower()] = true
	var pickable: Array = []
	for polity in (_state.get("roster", []) as Array):
		if not taken.has(str(polity).to_lower()):
			pickable.append(str(polity))
	_picker.set_polities(pickable)
	var unmatched := _unmatched(names)
	EditorKit.clear(_chips_holder)
	if names.is_empty():
		var empty := PanelContainer.new()
		var style := UI.box(Color(1, 1, 1, 0.02), Color(1, 1, 1, 0.08), 10, 1, Vector4(12, 12, 12, 12))
		empty.add_theme_stylebox_override("panel", style)
		var label := UI.label("No starting members added.", 11, Color(1, 1, 1, 0.36))
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		empty.add_child(label)
		_chips_holder.add_child(empty)
	else:
		var flow := EditorKit.flow(6)
		for entry in names:
			var name := str(entry)
			var flagged := unmatched.has(name)
			var option: Dictionary = {} if flagged else (_lookup.get(PoliticalKit.clean(name).to_lower(), {}) as Dictionary)
			var label := str(option.get("label", name)) if not option.is_empty() else name
			flow.add_child(_chip(name, label, flagged, "Not a polity in this scenario" if flagged else str(option.get("polityKey", name)) if not option.is_empty() else name))
		_chips_holder.add_child(flow)
	EditorKit.clear(_unmatched_holder)
	if not unmatched.is_empty():
		var text := ("%s is not a polity in this scenario. Check the spelling: it is kept as written, and it will vote and count toward quorum as a member." % str(unmatched[0])) if unmatched.size() == 1 else ("%d members, marked ⚠, are not polities in this scenario. Check the spelling: they are kept as written, and they will vote and count toward quorum as members." % unmatched.size())
		_unmatched_holder.add_child(PoliticalKit.tone_box(text, Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.07), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.24), PoliticalKit.AMBER_INK, 10, 10, Vector4(10, 8, 10, 8)))
	if sync_bulk and is_instance_valid(_bulk_edit):
		_syncing = true
		_bulk_edit.text = str(_draft.get("membersText", ""))
		_syncing = false


func _chip(name: String, label: String, flagged: bool, tooltip: String) -> Control:
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", UI.box(Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.1) if flagged else Color(1, 1, 1, 0.05), Color(245 / 255.0, 158 / 255.0, 11 / 255.0, 0.38) if flagged else PoliticalKit.GREY_BORDER, 999, 1, Vector4(9, 4, 5, 4)))
	holder.tooltip_text = tooltip
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	var ink := PoliticalKit.AMBER_INK if flagged else UI.WHITE
	if flagged:
		row.add_child(UI.label("⚠", 11, ink))
	row.add_child(UI.label(label, 11, ink))
	var remove := Button.new()
	remove.text = "×"
	remove.flat = true
	remove.focus_mode = Control.FOCUS_NONE
	remove.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	remove.tooltip_text = "Remove %s" % label
	remove.add_theme_font_size_override("font_size", 13)
	for state in ["font_color", "font_hover_color", "font_pressed_color"]:
		remove.add_theme_color_override(state, Color(1, 1, 1, 0.55))
	var empty := StyleBoxEmpty.new()
	for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
		remove.add_theme_stylebox_override(state, empty)
	remove.custom_minimum_size = Vector2(14, 14)
	remove.pressed.connect(func() -> void: _remove_member(name))
	row.add_child(remove)
	holder.add_child(row)
	return holder


func _upload_logo() -> void:
	var source := await EditorKit.pick_file(_host(), false, "", PackedStringArray(["*.gif, *.jpeg, *.jpg, *.png, *.webp ; Images"]))
	if source.is_empty():
		return
	_message = ""
	var extension := source.get_extension().to_lower()
	if not LOGO_TYPES.has(extension):
		_message = "Upload a PNG, JPEG, WebP or GIF. SVG logos should use a normal scenario/public asset path rather than inline SVG."
		_update_message()
		return
	var bytes := FileAccess.get_file_as_bytes(source)
	if bytes.is_empty() and FileAccess.get_open_error() != OK:
		_message = "Could not read the selected logo file."
		_update_message()
		return
	if bytes.size() > 256 * 1024:
		_message = "Embedded institution logos are limited to 256 KB. Use a scenario/public asset path or web URL for larger artwork."
		_update_message()
		return
	_pending_logo = "data:%s;base64,%s" % [str(LOGO_TYPES[extension]), Marshalls.raw_to_base64(bytes)]
	_dirty = true
	_draft["logoUrl"] = ""
	_draft["logoAsset"] = true
	_refresh_visual()


func _save() -> void:
	if _scenario_id.is_empty() or _busy:
		return
	_busy = true
	_message = ""
	_update_header()
	var reply := await _engine.request("editor.politics.inst.save", {"scenarioId": _scenario_id, "draft": _draft, "pendingLogoDataUrl": _pending_logo})
	_busy = false
	if not is_inside_tree():
		return
	if not reply.get("ok", false):
		_message = str(reply.get("error", "Could not save institution."))
		_update_header()
		return
	var result: Dictionary = reply["result"]
	if bool(result.get("saved", false)):
		_take_state(result)
		_selected_id = str(result.get("selectedId", ""))
		_draft = (result.get("draft", {}) as Dictionary).duplicate(true)
		_pending_logo = ""
		_dirty = false
		_message = str(result.get("message", ""))
		_logo_cache.clear()
		_render_card()
		_render_list()
		_render_main()
		if result.get("details") is Dictionary:
			details_changed.emit(result["details"])
	else:
		_message = str(result.get("message", ""))
		_update_header()


func _delete() -> void:
	var selected := _row_by_id(_selected_id)
	if _scenario_id.is_empty() or _busy or selected.is_empty():
		return
	var label := str(selected.get("name", "")) if not str(selected.get("name", "")).is_empty() else str(selected.get("id", ""))
	if not await EditorKit.ask(_host(), "Delete %s from this scenario? Its members, history and logo go with it." % label):
		return
	_busy = true
	_message = ""
	_update_header()
	var reply := await _engine.request("editor.politics.inst.delete", {"scenarioId": _scenario_id, "institutionId": _selected_id})
	_busy = false
	if not is_inside_tree():
		return
	if not reply.get("ok", false):
		_message = str(reply.get("error", "Could not delete the institution."))
		_update_header()
		return
	var result: Dictionary = reply["result"]
	if bool(result.get("saved", false)):
		_take_state(result)
		_selected_id = ""
		_pending_logo = ""
		_dirty = false
		_message = str(result.get("message", ""))
		_reset_to_selection()
		_render_card()
		_render_list()
		_render_main()
		if result.get("details") is Dictionary:
			details_changed.emit(result["details"])
	else:
		_message = str(result.get("message", ""))
		_update_header()
