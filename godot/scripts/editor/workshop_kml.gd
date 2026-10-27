class_name WorkshopKml
extends RefCounted

const GEOMETRIES := ["Point", "LineString", "LinearRing", "Polygon", "MultiGeometry"]


static func kmz_text(path: String) -> String:
	var zip := ZIPReader.new()
	if zip.open(path) != OK:
		return ""
	var text := ""
	for name in zip.get_files():
		if name.to_lower().ends_with(".kml"):
			text = zip.read_file(name).get_string_from_utf8()
			break
	zip.close()
	return text


static func _local(name: String) -> String:
	var at := name.find(":")
	return name.substr(at + 1) if at >= 0 else name


static func _tree(text: String) -> Dictionary:
	var root := {"name": "", "children": [], "text": "", "attrs": {}}
	var parser := XMLParser.new()
	if parser.open_buffer(text.to_utf8_buffer()) != OK:
		return root
	var stack: Array = [root]
	while parser.read() == OK:
		var type := parser.get_node_type()
		if type == XMLParser.NODE_ELEMENT:
			var attrs := {}
			for index in range(parser.get_attribute_count()):
				attrs[_local(parser.get_attribute_name(index))] = parser.get_attribute_value(index)
			var node := {"name": _local(parser.get_node_name()), "children": [], "text": "", "attrs": attrs}
			((stack.back() as Dictionary)["children"] as Array).append(node)
			if not parser.is_empty():
				stack.append(node)
		elif type == XMLParser.NODE_ELEMENT_END:
			if stack.size() > 1:
				stack.pop_back()
		elif type == XMLParser.NODE_TEXT:
			var top: Dictionary = stack.back()
			top["text"] = str(top["text"]) + parser.get_node_data().xml_unescape()
		elif type == XMLParser.NODE_CDATA:
			var top: Dictionary = stack.back()
			top["text"] = str(top["text"]) + parser.get_node_data()
	return root


static func _child(node: Dictionary, name: String) -> Dictionary:
	for child in node.get("children", []):
		if str((child as Dictionary).get("name", "")) == name:
			return child
	return {}


static func _children(node: Dictionary, name: String) -> Array:
	var out: Array = []
	for child in node.get("children", []):
		if str((child as Dictionary).get("name", "")) == name:
			out.append(child)
	return out


static func _text(node: Dictionary) -> String:
	return str(node.get("text", "")).strip_edges()


static func _coordinates(node: Dictionary) -> Array:
	var out: Array = []
	var holder := _child(node, "coordinates")
	for token in _text(holder).replace("\n", " ").replace("\t", " ").replace("\r", " ").split(" ", false):
		var parts := token.split(",")
		if parts.size() >= 2 and parts[0].is_valid_float() and parts[1].is_valid_float():
			out.append([parts[0].to_float(), parts[1].to_float()])
	return out


static func _ring(node: Dictionary) -> Array:
	var ring := _child(node, "LinearRing")
	return _coordinates(ring) if not ring.is_empty() else []


static func _geometry(node: Dictionary) -> Variant:
	match str(node.get("name", "")):
		"Point":
			var points := _coordinates(node)
			return {"type": "Point", "coordinates": points[0]} if not points.is_empty() else null
		"LineString":
			var line := _coordinates(node)
			return {"type": "LineString", "coordinates": line} if line.size() >= 2 else null
		"LinearRing":
			var ring := _coordinates(node)
			return {"type": "Polygon", "coordinates": [ring]} if ring.size() >= 3 else null
		"Polygon":
			var rings: Array = []
			var outer := _child(node, "outerBoundaryIs")
			var shell := _ring(outer) if not outer.is_empty() else []
			if shell.size() < 3:
				return null
			rings.append(shell)
			for inner in _children(node, "innerBoundaryIs"):
				var hole := _ring(inner)
				if hole.size() >= 3:
					rings.append(hole)
			return {"type": "Polygon", "coordinates": rings}
		"MultiGeometry":
			var parts: Array = []
			for child in node.get("children", []):
				if str((child as Dictionary).get("name", "")) in GEOMETRIES:
					var part: Variant = _geometry(child)
					if part is Dictionary:
						parts.append(part)
			if parts.is_empty():
				return null
			var kinds := {}
			for part in parts:
				kinds[str((part as Dictionary)["type"])] = true
			if kinds.size() == 1:
				var kind := str(kinds.keys()[0])
				if kind in ["Point", "LineString", "Polygon"]:
					var coordinates: Array = []
					for part in parts:
						coordinates.append((part as Dictionary)["coordinates"])
					return {"type": "Multi" + kind, "coordinates": coordinates}
			return {"type": "GeometryCollection", "geometries": parts}
	return null


static func _placemarks(node: Dictionary, out: Array) -> void:
	for child in node.get("children", []):
		var entry: Dictionary = child
		if str(entry.get("name", "")) == "Placemark":
			out.append(entry)
		else:
			_placemarks(entry, out)


static func to_geojson(text: String) -> Dictionary:
	var marks: Array = []
	_placemarks(_tree(text), marks)
	var features: Array = []
	for entry in marks:
		var mark: Dictionary = entry
		var geometry: Variant = null
		for child in mark.get("children", []):
			if str((child as Dictionary).get("name", "")) in GEOMETRIES:
				geometry = _geometry(child)
				break
		var properties := {}
		for key in ["name", "description", "address", "phoneNumber"]:
			var field := _child(mark, key)
			if not field.is_empty():
				properties[key] = _text(field)
		var extended := _child(mark, "ExtendedData")
		for data in _children(extended, "Data"):
			var value := _child(data, "value")
			properties[str((data as Dictionary).get("attrs", {}).get("name", ""))] = _text(value)
		for schema in _children(extended, "SchemaData"):
			for simple in _children(schema, "SimpleData"):
				properties[str((simple as Dictionary).get("attrs", {}).get("name", ""))] = _text(simple)
		var feature := {"type": "Feature", "geometry": geometry, "properties": properties}
		var id := str((mark.get("attrs", {}) as Dictionary).get("id", ""))
		if not id.is_empty():
			feature["id"] = id
		features.append(feature)
	return {"type": "FeatureCollection", "features": features}
