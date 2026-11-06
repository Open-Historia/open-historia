class_name StyleSettle
extends RefCounted

const SETTLED := &"oh_style_settled"
const FROM := &"oh_border_from"
const TINT_FROM := &"oh_border_tint_from"
const TINT_LAID := &"oh_border_tint_laid"

static var _installed := false
static var _names: Dictionary = {}
static var _busy := false


static func install() -> void:
	if _installed:
		return
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null or tree.root == null:
		return
	_installed = true
	tree.node_added.connect(_on_node_added)
	_sweep(tree.root)


static func _sweep(node: Node) -> void:
	_on_node_added(node)
	for child in node.get_children():
		_sweep(child)


static func _on_node_added(node: Node) -> void:
	if not (node is Control or node is Window):
		return
	var held: WeakRef = weakref(node)
	if not node.has_meta(SETTLED):
		node.set_meta(SETTLED, true)
		node.connect("theme_changed", Callable(StyleSettle, "_settle_node").bind(held))
	_settle_node(held)


static func _settle_node(ref: WeakRef) -> void:
	var node: Node = ref.get_ref()
	if node == null:
		return
	for item in _names_for(node.get_class()):
		if node.call("has_theme_stylebox_override", item):
			settle(node.call("get_theme_stylebox", item))
	var own: Variant = node.get("theme")
	if own is Theme:
		settle_theme(own)


static func settle_theme(theme: Theme) -> void:
	if not theme.has_meta(SETTLED):
		theme.set_meta(SETTLED, true)
		var held: WeakRef = weakref(theme)
		theme.changed.connect(func() -> void:
			var again: Theme = held.get_ref()
			if again:
				_settle_theme_boxes(again))
	_settle_theme_boxes(theme)


static func _settle_theme_boxes(theme: Theme) -> void:
	for type in theme.get_stylebox_type_list():
		for item in theme.get_stylebox_list(type):
			settle(theme.get_stylebox(item, type))


static func _names_for(kind: String) -> Array:
	if _names.has(kind):
		return _names[kind]
	var found := {}
	var base := ThemeDB.get_default_theme()
	var at := kind
	while not at.is_empty():
		for item in base.get_stylebox_list(at):
			found[item] = true
		at = ClassDB.get_parent_class(at)
	if kind == "Panel" or kind == "PanelContainer" or found.is_empty():
		found["panel"] = true
	_names[kind] = found.keys()
	return _names[kind]


static func settle(box: StyleBox) -> void:
	var flat := box as StyleBoxFlat
	if flat == null:
		return
	if not flat.has_meta(SETTLED):
		flat.set_meta(SETTLED, true)
		var held: WeakRef = weakref(flat)
		flat.changed.connect(func() -> void:
			var again: StyleBoxFlat = held.get_ref()
			if again:
				lay_border(again))
	lay_border(flat)


static func lay_border(flat: StyleBoxFlat) -> void:
	if _busy:
		return
	_busy = true
	_lay(flat)
	_tint(flat)
	_busy = false


static func _lay(flat: StyleBoxFlat) -> void:
	var widths := [flat.border_width_left, flat.border_width_top, flat.border_width_right, flat.border_width_bottom]
	if flat.has_meta(FROM):
		var kept: Dictionary = flat.get_meta(FROM)
		if widths != [0, 0, 0, 0]:
			flat.remove_meta(FROM)
		elif _decorative(flat.border_color, flat):
			return
		else:
			flat.remove_meta(FROM)
			var put_back: Array = kept["widths"]
			var margins: Array = kept["margins"]
			for side in range(4):
				flat.set_content_margin(side as Side, float(margins[side]))
			flat.border_width_left = int(put_back[0])
			flat.border_width_top = int(put_back[1])
			flat.border_width_right = int(put_back[2])
			flat.border_width_bottom = int(put_back[3])
			return
	if widths == [0, 0, 0, 0] or not _decorative(flat.border_color, flat) or not (widths[0] == widths[1] and widths[1] == widths[2] and widths[2] == widths[3]):
		return
	var margins := []
	for side in range(4):
		margins.append(flat.get_content_margin(side as Side))
	flat.set_meta(FROM, {"widths": widths, "margins": margins})
	for side in range(4):
		if flat.get_content_margin(side as Side) < 0.0:
			flat.set_content_margin(side as Side, float(widths[side]))
	flat.set_border_width_all(0)


static func _decorative(border: Color, flat: StyleBoxFlat) -> bool:
	return border.a < 1.0 and border.a > 0.0 and border.s < 0.2 and flat.draw_center and flat.bg_color.a > 0.0


static func _tint(flat: StyleBoxFlat) -> void:
	var border := flat.border_color
	var laid_before := flat.has_meta(TINT_LAID) and border.is_equal_approx(flat.get_meta(TINT_LAID))
	if laid_before:
		border = flat.get_meta(TINT_FROM)
	if border.a > 0.0 and border.a < 1.0 and flat.draw_center and flat.bg_color.a >= 1.0 and _has_border(flat):
		var laid := flat.bg_color.blend(border)
		flat.set_meta(TINT_FROM, border)
		flat.set_meta(TINT_LAID, laid)
		if not flat.border_color.is_equal_approx(laid):
			flat.border_color = laid
	elif laid_before:
		flat.remove_meta(TINT_LAID)
		flat.remove_meta(TINT_FROM)
		flat.border_color = border


static func _has_border(flat: StyleBoxFlat) -> bool:
	return flat.border_width_left > 0 or flat.border_width_top > 0 or flat.border_width_right > 0 or flat.border_width_bottom > 0
