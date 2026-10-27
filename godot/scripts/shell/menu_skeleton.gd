class_name MenuSkeleton
extends RefCounted

const REM := 16.0
const GROUND := Color(1, 1, 1, 0.03)
const EDGE := Color(1, 1, 1, 0.08)
const INK := Color(1, 1, 1, 0.07)
const BAND := Color(1, 1, 1, 0.06)
const GLIMMER_SECONDS := 1.9
const GLIMMER_CROSS := 0.65
const COMMUNITY_CONTROLS := [12.0, 4.6, 8.4, 6.4, 9.0]
const LOBBY_COLUMNS := [0.24, 0.2, 0.1, 0.1, 0.1, 0.08]
const LOBBY_FILTERS := [7.5, 7.0, 8.0, 7.5]

static var reduce_motion := false


class Shape extends Control:
	var share := 1.0
	var fixed := 0.0
	var height_px := 12.8
	var radius := 999.0
	var aspect := 0.0

	func _init(width: Variant, height: float, corner: float) -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		height_px = height
		radius = corner
		if width is float or width is int:
			fixed = float(width)
			share = -1.0
			custom_minimum_size = Vector2(fixed, height)
			size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		else:
			share = float(str(width).trim_suffix("%")) / 100.0
			custom_minimum_size = Vector2(0, height)
			size_flags_horizontal = Control.SIZE_FILL

	func _notification(what: int) -> void:
		if what == NOTIFICATION_RESIZED and aspect > 0.0:
			var wanted := size.x / aspect
			if absf(custom_minimum_size.y - wanted) > 0.5:
				custom_minimum_size.y = wanted
				height_px = wanted

	func _draw() -> void:
		var width := fixed if share < 0.0 else size.x * minf(share, 1.0)
		var height := minf(height_px, size.y) if aspect <= 0.0 else size.y
		var corner := minf(radius, minf(width, height) * 0.5)
		var style := StyleBoxFlat.new()
		style.bg_color = MenuSkeleton.INK
		style.set_corner_radius_all(int(round(corner)))
		style.anti_aliasing = true
		draw_style_box(style, Rect2(Vector2.ZERO, Vector2(width, height)))


class Glimmer extends Control:
	var radius := 24.0
	var clock := 0.0

	func _init(corner: float) -> void:
		radius = corner
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _process(delta: float) -> void:
		if MenuSkeleton.reduce_motion or not is_visible_in_tree():
			return
		clock = fposmod(clock + delta, MenuSkeleton.GLIMMER_SECONDS)
		queue_redraw()

	func _rounded(rect: Rect2) -> PackedVector2Array:
		var points := PackedVector2Array()
		var corner := minf(radius, minf(rect.size.x, rect.size.y) * 0.5)
		var centres := [rect.position + Vector2(rect.size.x - corner, corner), rect.position + Vector2(rect.size.x - corner, rect.size.y - corner), rect.position + Vector2(corner, rect.size.y - corner), rect.position + Vector2(corner, corner)]
		var starts := [-PI * 0.5, 0.0, PI * 0.5, PI]
		for index in range(4):
			for step in range(9):
				var angle: float = starts[index] + PI * 0.5 * float(step) / 8.0
				points.append((centres[index] as Vector2) + Vector2(cos(angle), sin(angle)) * corner)
		return points

	func _draw() -> void:
		if MenuSkeleton.reduce_motion or size.x <= 0.0:
			return
		var cross := MenuSkeleton.GLIMMER_SECONDS * MenuSkeleton.GLIMMER_CROSS
		if clock >= cross:
			return
		var band := size.x * 0.4
		var t := CubicBezier.named("ease-in-out").at(clock / cross)
		var left := lerpf(-band, band * 2.5, t)
		var strip := PackedVector2Array([Vector2(left, 0), Vector2(left + band, 0), Vector2(left + band, size.y), Vector2(left, size.y)])
		for piece in Geometry2D.intersect_polygons(strip, _rounded(Rect2(Vector2.ZERO, size))):
			if piece.size() >= 3:
				draw_colored_polygon(piece, MenuSkeleton.BAND)


class Card extends Container:
	var radius := 24.0
	var padding := Vector4(19.2, 19.2, 19.2, 19.2)
	var content: Control
	var glimmer: Glimmer
	var min_height := 0.0

	func _init(corner: float, inner: Vector4, body: Control, least_height := 0.0, shimmer := true) -> void:
		radius = corner
		padding = inner
		min_height = least_height
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		content = body
		add_child(content)
		if shimmer:
			glimmer = Glimmer.new(corner)
			add_child(glimmer)

	func _get_minimum_size() -> Vector2:
		var inner := content.get_combined_minimum_size()
		return Vector2(inner.x + padding.x + padding.z, maxf(min_height, inner.y + padding.y + padding.w))

	func _notification(what: int) -> void:
		if what == NOTIFICATION_SORT_CHILDREN:
			fit_child_in_rect(content, Rect2(Vector2(padding.x, padding.y), size - Vector2(padding.x + padding.z, padding.y + padding.w)))
			if glimmer:
				fit_child_in_rect(glimmer, Rect2(Vector2.ZERO, size))

	func _draw() -> void:
		var style := StyleBoxFlat.new()
		style.bg_color = MenuSkeleton.GROUND
		style.border_color = MenuSkeleton.EDGE
		style.set_border_width_all(1)
		style.set_corner_radius_all(int(round(radius)))
		style.anti_aliasing = true
		draw_style_box(style, Rect2(Vector2.ZERO, size))


static func _shape(width: Variant, height_rem: float, radius_px := 999.0) -> Shape:
	var width_value: Variant = width
	if width is float or width is int:
		width_value = float(width) * REM
	return Shape.new(width_value, height_rem * REM, radius_px)


static func _column(gap := 0.0) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", roundi(gap * REM))
	return column


static func _row(gap := 0.0) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_theme_constant_override("separation", roundi(gap * REM))
	return row


static func _gap(height_rem: float) -> Control:
	var gap := Control.new()
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	gap.custom_minimum_size.y = height_rem * REM
	return gap


static func _stack(items: Array) -> VBoxContainer:
	var column := _column()
	for item in items:
		column.add_child(item as Control)
	return column


static func _expanding(node: Control) -> Control:
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return node


static func _library_card(top: Control, bottom: Control, width: float) -> Card:
	var body := _column()
	body.add_child(top)
	var spring := Control.new()
	spring.mouse_filter = Control.MOUSE_FILTER_IGNORE
	spring.size_flags_vertical = Control.SIZE_EXPAND_FILL
	spring.custom_minimum_size.y = 1.5 * REM
	body.add_child(spring)
	body.add_child(bottom)
	var card := Card.new(24.0, Vector4(1.2 * REM, 1.2 * REM, 1.2 * REM, 1.2 * REM), body, 22.0 * REM)
	if width > 0.0:
		card.custom_minimum_size.x = width
	return card


static func game_card(width := 0.0) -> Control:
	var head := _row(0.5)
	var left := _row(0.5)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var pill := _shape(6.2, 1.65)
	pill.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	left.add_child(pill)
	var caption := _shape("38%", 0.76, 6.0)
	caption.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	caption.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	left.add_child(caption)
	head.add_child(left)
	var more := _shape(2.2, 2.2)
	more.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(more)
	var top := _stack([head, _gap(2.0), _shape("62%", 1.5, 7.0), _gap(0.75), _shape("80%", 0.92, 6.0), _gap(0.85), _shape("94%", 0.84, 6.0), _gap(0.45), _shape("68%", 0.84, 6.0)])
	var bottom := _stack([_shape("56%", 0.8, 6.0), _gap(0.9), _shape("100%", 2.2), _gap(0.55), _shape("100%", 2.2)])
	return _library_card(top, bottom, width)


static func scenario_card(width := 0.0) -> Control:
	var head := _row()
	var pill := _shape(6.6, 1.65)
	pill.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(pill)
	head.add_child(UI.spacer())
	var count := _shape(3.8, 0.74, 6.0)
	count.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	head.add_child(count)
	var top := _stack([head, _gap(4.0), _shape("72%", 2.0, 8.0), _gap(0.9), _shape("88%", 0.92, 6.0), _gap(0.42), _shape("80%", 0.92, 6.0), _gap(0.42), _shape("52%", 0.92, 6.0)])
	var pair := _row(0.55)
	pair.add_child(_expanding(_shape("100%", 2.2)))
	pair.add_child(_expanding(_shape("100%", 2.2)))
	var bottom := _stack([_shape("64%", 0.8, 6.0), _gap(0.9), pair, _gap(0.55), _shape("100%", 2.2)])
	return _library_card(top, bottom, width)


static func cards(kind: String, count: int, width := 0.0) -> Array[Control]:
	var made: Array[Control] = []
	for index in range(count):
		made.append(scenario_card(width) if kind == "scenario" else game_card(width))
	return made


static func community_card() -> Control:
	var body := _column(0.55)
	var picture := _shape("100%", 0.0, 10.0)
	picture.aspect = 16.0 / 9.0
	body.add_child(picture)
	var byline := _row(0.55)
	var face := _shape(1.6, 1.6)
	face.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	byline.add_child(face)
	var names := _column(0.32)
	names.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	names.add_child(_shape("72%", 0.95, 6.0))
	names.add_child(_shape("46%", 0.7, 6.0))
	byline.add_child(names)
	body.add_child(byline)
	var about := _column(0.42)
	about.size_flags_vertical = Control.SIZE_EXPAND_FILL
	about.add_child(_shape("96%", 0.8, 6.0))
	about.add_child(_shape("70%", 0.8, 6.0))
	body.add_child(about)
	var counts := _row(0.5)
	for index in range(3):
		var tally := _shape(2.0, 0.76, 6.0)
		tally.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		counts.add_child(tally)
	counts.add_child(UI.spacer())
	for width in [4.6, 4.2]:
		var button := _shape(width, 1.8)
		button.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		counts.add_child(button)
	body.add_child(counts)
	var card := Card.new(16.0, Vector4(0.9 * REM, 0.9 * REM, 0.9 * REM, 0.9 * REM), body)
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return card


class FillGrid extends Container:
	var least := 264.0
	var gap := 12.8

	func _init(min_width: float, spacing: float) -> void:
		least = min_width
		gap = spacing
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _columns() -> int:
		return maxi(1, int(floor((size.x + gap) / (minf(least, size.x) + gap)))) if size.x > 0.0 else 1

	func _get_minimum_size() -> Vector2:
		var columns := _columns()
		var height := 0.0
		var row_height := 0.0
		var index := 0
		for child in get_children():
			var control := child as Control
			if control == null or not control.visible:
				continue
			row_height = maxf(row_height, control.get_combined_minimum_size().y)
			index += 1
			if index % columns == 0:
				height += row_height + gap
				row_height = 0.0
		if index % columns != 0:
			height += row_height + gap
		return Vector2(0.0, maxf(0.0, height - gap))

	func _notification(what: int) -> void:
		if what != NOTIFICATION_SORT_CHILDREN:
			return
		var columns := _columns()
		var width := (size.x - gap * float(columns - 1)) / float(columns)
		var visible_children: Array[Control] = []
		for child in get_children():
			var control := child as Control
			if control and control.visible:
				visible_children.append(control)
		var y := 0.0
		for start in range(0, visible_children.size(), columns):
			var row_height := 0.0
			for index in range(start, mini(start + columns, visible_children.size())):
				row_height = maxf(row_height, visible_children[index].get_combined_minimum_size().y)
			for index in range(start, mini(start + columns, visible_children.size())):
				fit_child_in_rect(visible_children[index], Rect2(Vector2(float(index - start) * (width + gap), y), Vector2(width, row_height)))
			y += row_height + gap
		update_minimum_size()


static func community(count := 8, with_header := false) -> Control:
	var page := _column()
	if with_header:
		var header := HFlowContainer.new()
		header.mouse_filter = Control.MOUSE_FILTER_IGNORE
		header.add_theme_constant_override("h_separation", roundi(REM))
		header.add_theme_constant_override("v_separation", roundi(0.5 * REM))
		var help := _column(0.42)
		help.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		help.custom_minimum_size.x = 20.0 * REM
		help.add_child(_shape("92%", 0.78, 6.0))
		help.add_child(_shape("58%", 0.78, 6.0))
		header.add_child(help)
		var controls := _row(0.5)
		for width in COMMUNITY_CONTROLS:
			controls.add_child(_shape(float(width), 2.0))
		header.add_child(controls)
		page.add_child(header)
		page.add_child(_gap(0.9))
		page.add_child(_shape(16.0, 0.76, 6.0))
		page.add_child(_gap(0.7))
	var grid := FillGrid.new(16.5 * REM, 0.8 * REM)
	for index in range(count):
		grid.add_child(community_card())
	page.add_child(grid)
	page.add_child(_gap(0.35))
	return page


static func _lobby_card(body: Control) -> Card:
	return Card.new(18.0, Vector4(1.3 * REM, 1.2 * REM, 1.3 * REM, 1.2 * REM), body)


static func lobbies() -> Control:
	var page := _column(1.1)
	page.custom_minimum_size.x = 0.0
	var join := _column()
	join.add_child(_shape(13.0, 1.1, 6.0))
	join.add_child(_gap(0.75))
	join.add_child(_shape("88%", 0.86, 6.0))
	join.add_child(_gap(0.45))
	join.add_child(_shape("54%", 0.86, 6.0))
	join.add_child(_gap(1.1))
	var fields := _row(0.7)
	var code := _column()
	code.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	code.size_flags_stretch_ratio = 3.0
	code.size_flags_vertical = Control.SIZE_SHRINK_END
	code.add_child(_shape(6.0, 0.72, 6.0))
	code.add_child(_gap(0.45))
	code.add_child(_shape("100%", 2.6, 12.0))
	fields.add_child(code)
	var name := _column()
	name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name.size_flags_vertical = Control.SIZE_SHRINK_END
	name.add_child(_shape(5.0, 0.72, 6.0))
	name.add_child(_gap(0.45))
	name.add_child(_shape("100%", 2.6, 12.0))
	fields.add_child(name)
	var go := _shape(4.6, 2.75)
	go.size_flags_vertical = Control.SIZE_SHRINK_END
	fields.add_child(go)
	join.add_child(fields)
	join.add_child(_gap(1.0))
	join.add_child(_shape("96%", 0.78, 6.0))
	join.add_child(_gap(0.42))
	join.add_child(_shape("72%", 0.78, 6.0))
	page.add_child(_lobby_card(join))
	var public := _column()
	public.add_child(_shape(9.0, 1.1, 6.0))
	public.add_child(_gap(0.9))
	var filters := _row(0.5)
	filters.add_child(_expanding(_shape("100%", 2.1, 10.0)))
	for width in LOBBY_FILTERS:
		filters.add_child(_shape(float(width), 2.1, 10.0))
	public.add_child(filters)
	public.add_child(_gap(0.8))
	for row_index in range(4):
		if row_index > 0:
			var line := ColorRect.new()
			line.color = Color(1, 1, 1, 0.06)
			line.custom_minimum_size.y = 1
			line.mouse_filter = Control.MOUSE_FILTER_IGNORE
			public.add_child(line)
		var margin := MarginContainer.new()
		margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
		for side in [["margin_left", 8], ["margin_right", 8], ["margin_top", 10], ["margin_bottom", 10]]:
			margin.add_theme_constant_override(side[0], side[1])
		var cells := _row(1.0)
		for share in LOBBY_COLUMNS:
			var cell := _shape("100%", 0.82 if row_index > 0 else 0.72, 6.0)
			cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			cell.size_flags_stretch_ratio = float(share) * 100.0
			cells.add_child(cell)
		var rest := Control.new()
		rest.mouse_filter = Control.MOUSE_FILTER_IGNORE
		rest.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rest.size_flags_stretch_ratio = 18.0
		cells.add_child(rest)
		margin.add_child(cells)
		public.add_child(margin)
	page.add_child(_lobby_card(public))
	var holder := MarginContainer.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(page)
	holder.custom_minimum_size.x = 0.0
	return holder
